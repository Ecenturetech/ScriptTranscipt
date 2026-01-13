// Polyfill para funções modernas do Node.js necessárias para o pdfjs-dist
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

// Polyfill para getBuiltinModule que o PDF.js usa para detectar o ambiente
if (typeof process.getBuiltinModule === 'undefined') {
  process.getBuiltinModule = function(name) {
    return null; 
  };
}
