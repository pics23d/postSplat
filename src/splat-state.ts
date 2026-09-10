// per-gaussian editor state bits. the live storage lives on the instance list
// (see src/gaussian-instances.ts); this is just the shared vocabulary.
// deletion is not a state: it removes instances from the list
// [custom] hidden (user CR 2026-09-08, replaces upstream's "locked" on the same
// bit): culled from every pass, unselectable, protected from delete. The value
// is the PLY state column's bit 2, so older files' locked splats load as hidden
enum State {
    selected = 1,
    hidden = 2
}

export { State };
