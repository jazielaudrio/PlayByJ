// Shared football-field geometry for the editor canvas, thumbnail diagrams,
// and PDF export so every renderer draws the exact same field.
export const FIELD_W = 800;
export const FIELD_H = 500;

// Single line of scrimmage — the reference every play is drawn from.
// Offense lines up on this line; upfield is -y.
export const LOS_Y = 372;

// 100px ≈ 5 yards (matches the built-in sample playbook scale).
export const PX_PER_YARD = 20;
