// The page footer (10 section 4.3). `👍 Like` is not built; labels and comments are `later`.
// v1 lays the region out with only what ships — nothing — and reserves the two rows labels and
// comments will take, below everything else, so their arrival moves nothing. Decorative until
// then: no landmark, hidden from assistive technology.
// spec: docs/specs/10-ui-reference.md section 4.3 (Footer)
export function PageFooter() {
  return (
    <div aria-hidden="true" className="mt-12 border-t border-slate-100 pt-4" data-testid="page-footer">
      <div className="h-6" data-slot="labels" />
      <div className="mt-4 h-10" data-slot="comments" />
    </div>
  );
}
