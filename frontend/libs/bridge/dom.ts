// Loose types for the searches in the page.
//
// The app came from JavaScript. Its code reads `value`, `disabled`, `dataset` and other properties
// from the result of a search, without a check of the kind of element. These declarations keep
// that code valid while the app moves to modules with exact types.

interface ParentNode {
  querySelector(selectors: string): any;
  querySelectorAll(selectors: string): NodeListOf<any>;
}

interface Element {
  closest(selectors: string): any;
}
