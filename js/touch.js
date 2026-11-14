// Touch controls: virtual joystick + action buttons (player mode),
// manager control bar (speed, tactics, subs). iPad Safari: pointer events.
export function attachJoystick(el, onMove) {
  const knob = el.querySelector('#joyknob');
  let active = false, cx = 0, cy = 0, R = 54;
  const set = (dx, dy) => {
    const d = Math.hypot(dx, dy);
    const k = d > R ? R / d : 1;
    knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
    onMove(dx / R, dy / R, d > R);
  };
  const down = (e) => {
    const r = el.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width / 2 - 6;
    active = true; move(e);
  };
  const move = (e) => {
    if (!active) return;
    const t = e.touches ? e.touches[0] : e;
    set(t.clientX - cx, t.clientY - cy);
    e.preventDefault();
  };
  const up = () => { active = false; knob.style.transform = 'translate(-50%,-50%)'; onMove(0, 0, false); };
  el.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  return { detach: () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); } };
}

export function button(el, onTap) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); }, { passive: false });
}
