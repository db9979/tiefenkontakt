import type { IceServerConfig, ServerMsg, VoiceLink, VoicePeer, VoiceSignal } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { RadioChannel } from './radio-fx.js';
import type { SfuLink } from './sfu.js';

/**
 * Voice radio client. Mesh mode: one WebRTC connection per team mate, signalled through the
 * game server; the microphone track is only enabled while the push-to-talk key is held AND
 * the server confirms we are on the air. SFU mode (LiveKit configured on the server): the
 * server grants publishing per transmission and listening per radio state. In both modes each
 * incoming voice runs through a radio channel whose loudness and hiss follow the link quality.
 */

type VoiceStateMsg = Extract<ServerMsg, { t: 'voice'; op: 'state' }>;

interface Peer { info: VoicePeer; pc?: RTCPeerConnection; channel?: RadioChannel; el?: HTMLAudioElement; pending: RTCIceCandidateInit[] }

const VOL_KEY = 'tk_voice_vol';

export class VoiceClient {
  joined = false;
  joining = false;
  mode: 'mesh' | 'sfu' = 'mesh';
  error?: string;
  peers = new Map<string, Peer>();
  state?: VoiceStateMsg;
  pttHeld = false;
  /** Microphone level 0..1 (for the meter). */
  level = 0;
  private ctx?: AudioContext;
  private master?: GainNode;
  private stream?: MediaStream;
  private ice: IceServerConfig[] = [];
  private analyser?: AnalyserNode;
  private sfu?: SfuLink;
  private listeners = new Set<() => void>();
  private off?: () => void;

  constructor() {
    this.off = net.on((m) => {
      if (m.t === 'voice') void this.onMsg(m);
      if (m.t === 'end' || m.t === 'removed') this.leave();
    });
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private emit(): void {
    for (const f of this.listeners) f();
  }

  get volume(): number {
    return Number(localStorage.getItem(VOL_KEY) ?? '0.9');
  }

  set volume(v: number) {
    localStorage.setItem(VOL_KEY, String(v));
    if (this.master) this.master.gain.value = v;
  }

  /** Switch voice radio on: asks for the microphone, then joins the team net. */
  async join(): Promise<void> {
    if (this.joined || this.joining) return;
    this.joining = true;
    this.error = undefined;
    this.emit();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      for (const t of this.stream.getAudioTracks()) t.enabled = false;
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
      this.joined = true;
      net.send({ t: 'voice', op: 'join' });
      this.meter();
    } catch (e) {
      this.error = (e as Error).name === 'NotAllowedError' ? 'Mikrofon nicht freigegeben' : 'Kein Mikrofon gefunden';
      this.stopLocal();
    }
    this.joining = false;
    this.emit();
  }

  leave(): void {
    if (!this.joined) return;
    net.send({ t: 'voice', op: 'leave' });
    for (const p of this.peers.values()) this.closePeer(p);
    this.peers.clear();
    void this.sfu?.close();
    this.sfu = undefined;
    this.stopLocal();
    this.joined = false;
    this.state = undefined;
    this.emit();
  }

  private stopLocal(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = undefined;
    void this.ctx?.close();
    this.ctx = undefined;
    this.master = undefined;
  }

  /** Push-to-talk pressed or released. */
  ptt(on: boolean): void {
    if (!this.joined || on === this.pttHeld) return;
    this.pttHeld = on;
    net.send({ t: 'voice', op: 'ptt', on });
    if (!on) this.setMic(false);
    this.emit();
  }

  private setMic(on: boolean): void {
    for (const t of this.stream?.getAudioTracks() ?? []) t.enabled = on;
    void this.sfu?.setMic(on);
  }

  private meter(): void {
    if (!this.analyser || !this.joined) return;
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
    this.level = this.level * 0.7 + peak * 0.3;
    setTimeout(() => this.meter(), 100);
  }

  private async onMsg(m: Extract<ServerMsg, { t: 'voice' }>): Promise<void> {
    if (!this.joined) return;
    if (m.op === 'config') {
      this.ice = m.ice;
      if (m.sfu && this.ctx && this.master && this.stream) {
        this.mode = 'sfu';
        const { SfuLink } = await import('./sfu.js');
        this.sfu = new SfuLink(this.ctx, (id) => this.channelFor(id), () => this.emit());
        try {
          await this.sfu.connect(m.sfu.url, m.sfu.token, this.stream.getAudioTracks()[0]!);
        } catch {
          this.error = 'Sprachserver nicht erreichbar';
        }
      }
    } else if (m.op === 'peers') {
      const ids = new Set(m.peers.map((p) => p.playerId));
      for (const [id, p] of this.peers) if (!ids.has(id)) (this.closePeer(p), this.peers.delete(id));
      for (const info of m.peers) {
        const p = this.peers.get(info.playerId) ?? { info, pending: [] };
        p.info = info;
        this.peers.set(info.playerId, p);
        if (this.mode === 'mesh' && !p.pc) this.connectPeer(p);
      }
    } else if (m.op === 'signal') {
      await this.onSignal(m.from, m.data);
    } else if (m.op === 'state') {
      this.state = m;
      // Send only while the key is held and the server has us on the air
      this.setMic(this.pttHeld && m.ptt);
      for (const l of m.links) this.applyLink(l);
    }
    this.emit();
  }

  private applyLink(l: VoiceLink): void {
    const p = this.peers.get(l.playerId);
    if (!p) return;
    this.channelFor(l.playerId)?.set(l.q, l.talking);
  }

  /** The radio channel a team mate's voice plays through (created on first use). */
  private channelFor(id: string): RadioChannel | undefined {
    const p = this.peers.get(id);
    if (!p || !this.ctx || !this.master) return undefined;
    p.channel ??= new RadioChannel(this.ctx, this.master, p.info.sameShip);
    return p.channel;
  }

  private connectPeer(p: Peer): void {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    p.pc = pc;
    for (const t of this.stream?.getAudioTracks() ?? []) pc.addTrack(t, this.stream!);
    pc.onicecandidate = (e) => {
      if (e.candidate) net.send({ t: 'voice', op: 'signal', to: p.info.playerId, data: { ice: e.candidate.toJSON() as VoiceSignal['ice'] } });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      // Chrome only feeds remote WebRTC audio into WebAudio while a (muted) element plays it
      p.el = document.createElement('audio');
      p.el.muted = true;
      p.el.srcObject = stream;
      void p.el.play().catch(() => undefined);
      const ch = this.channelFor(p.info.playerId);
      if (ch && this.ctx) this.ctx.createMediaStreamSource(stream).connect(ch.input);
    };
    pc.onconnectionstatechange = () => this.emit();
    // The lower id makes the offer, the other answers (no glare)
    if ((store.playerId ?? '') < p.info.playerId) {
      void (async () => {
        await pc.setLocalDescription(await pc.createOffer());
        net.send({ t: 'voice', op: 'signal', to: p.info.playerId, data: { sdp: { type: 'offer', sdp: pc.localDescription!.sdp } } });
      })();
    }
  }

  private async onSignal(from: string, data: VoiceSignal): Promise<void> {
    const p = this.peers.get(from);
    if (!p || this.mode !== 'mesh') return;
    if (!p.pc) this.connectPeer(p);
    const pc = p.pc!;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        for (const c of p.pending.splice(0)) await pc.addIceCandidate(c);
        if (data.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          net.send({ t: 'voice', op: 'signal', to: from, data: { sdp: { type: 'answer', sdp: pc.localDescription!.sdp } } });
        }
      } else if (data.ice) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.ice);
        else p.pending.push(data.ice);
      }
    } catch {
      // A broken negotiation: start over with this peer
      this.closePeer(p);
      this.connectPeer(p);
    }
  }

  private closePeer(p: Peer): void {
    p.pc?.close();
    p.pc = undefined;
    p.channel?.close();
    p.channel = undefined;
    if (p.el) p.el.srcObject = null;
    p.el = undefined;
  }

  /** Connection state of a team mate's line, for the panel. */
  linkState(id: string): 'ok' | 'connecting' | 'failed' {
    if (this.mode === 'sfu') return this.sfu?.connected(id) ? 'ok' : 'connecting';
    const s = this.peers.get(id)?.pc?.connectionState;
    return s === 'connected' ? 'ok' : s === 'failed' || s === 'closed' ? 'failed' : 'connecting';
  }

  dispose(): void {
    this.leave();
    this.off?.();
  }
}

export const voice = new VoiceClient();
