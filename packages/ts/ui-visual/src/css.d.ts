// esbuild inlines *.css via the `text` loader; this declares the string default export
// so tsc (which never sees the loader) still typechecks the render entry.
declare module "*.css" {
  const content: string;
  export default content;
}
