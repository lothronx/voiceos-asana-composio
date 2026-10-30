// Turns the tool's due_on / due_time args into Asana's due_on or due_at.
// due_time is wall-clock time; this server runs on the user's Mac, so the local zone is theirs.
export function dueFields(due_on?: string, due_time?: string): { due_on?: string; due_at?: string } {
  // No date means no due date; a leftover time (the user cleared only the date on the card) is ignored.
  if (!due_on) return {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due_on)) throw new Error(`Due date "${due_on}" is not YYYY-MM-DD.`);
  if (!due_time) return { due_on };
  // Models often drop the leading zero ("9:00"); pad it rather than fail after the user approved.
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(due_time)) throw new Error(`Due time "${due_time}" is not HH:MM.`);
  const at = new Date(`${due_on}T${due_time.replace(/^(\d):/, "0$1:")}`);
  // Date rolls impossible values forward (Nov 31 -> Dec 1, 24:00 -> next day); reject instead.
  if (isNaN(at.getTime()) || at.getDate() !== Number(due_on.slice(8))) {
    throw new Error(`"${due_on} ${due_time}" is not a real date and time.`);
  }
  return { due_at: at.toISOString() };
}
