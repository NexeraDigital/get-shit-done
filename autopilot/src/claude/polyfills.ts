// Promise.withResolvers polyfill for Node.js 20 (ES2024 feature, native in Node 22+)
// Must be imported before any code that uses Promise.withResolvers()
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export {};  // Ensure this is treated as a module
