export function createPluginRuntimeStore() {
  let runtime;
  return {
    setRuntime(r) {
      runtime = r;
    },
    getRuntime() {
      return runtime;
    },
  };
}
