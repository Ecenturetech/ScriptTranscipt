if (typeof Promise.withResolvers === 'undefined') {
  Promise.withResolvers = function() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

if (typeof process.getBuiltinModule === 'undefined') {
  process.getBuiltinModule = function(name) {
    return null; 
  };
}
