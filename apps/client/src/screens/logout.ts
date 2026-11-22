/**
 * Sign out: ends the account session on the server (cookie), forgets the guest identity of
 * this tab and starts over at the sign-in screen. A running match keeps the ship (it waits
 * paused for the player like after a lost connection).
 */
export async function logout(): Promise<void> {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    /* offline: the local part still signs out */
  }
  sessionStorage.removeItem('tk_guest');
  sessionStorage.removeItem('tk_gid');
  location.hash = '';
  location.reload();
}
