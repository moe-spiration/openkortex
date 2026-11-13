// Joins argv into one shell line, quoting words that contain spaces or shell characters.
// Used instead of spawn(cmd, args, { shell: true }), which Node deprecates (DEP0190) because it only
// concatenates the arguments without escaping them.
export const shellLine = (argv) => argv.map((a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`)).join(" ");
