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

let domMatrixPolyfillLoaded = false;

async function loadDOMMatrixPolyfill() {
  if (domMatrixPolyfillLoaded || typeof globalThis.DOMMatrix !== 'undefined') {
    return;
  }
  
  try {
    const domMatrixModule = await import('@thednp/dommatrix');
    const DOMMatrix = domMatrixModule.default;
    globalThis.DOMMatrix = DOMMatrix;
    if (typeof global !== 'undefined') {
      global.DOMMatrix = DOMMatrix;
    }
    if (domMatrixModule.DOMMatrixReadOnly) {
      globalThis.DOMMatrixReadOnly = domMatrixModule.DOMMatrixReadOnly;
      if (typeof global !== 'undefined') {
        global.DOMMatrixReadOnly = domMatrixModule.DOMMatrixReadOnly;
      }
    } else if (domMatrixModule.default?.DOMMatrixReadOnly) {
      globalThis.DOMMatrixReadOnly = domMatrixModule.default.DOMMatrixReadOnly;
      if (typeof global !== 'undefined') {
        global.DOMMatrixReadOnly = domMatrixModule.default.DOMMatrixReadOnly;
      }
    }
    domMatrixPolyfillLoaded = true;
    console.log('[POLYFILL] DOMMatrix polyfill carregado com sucesso');
    console.log('[POLYFILL] DOMMatrix disponível em globalThis:', typeof globalThis.DOMMatrix);
  } catch (error) {
    console.warn('[POLYFILL] Erro ao carregar DOMMatrix polyfill:', error.message);
    class DOMMatrixPolyfill {
      constructor(init) {
        if (typeof init === 'string') {
          const matrix = init.match(/matrix\(([^)]+)\)/);
          if (matrix) {
            const values = matrix[1].split(',').map(v => parseFloat(v.trim()));
            this.a = values[0] || 1;
            this.b = values[1] || 0;
            this.c = values[2] || 0;
            this.d = values[3] || 1;
            this.e = values[4] || 0;
            this.f = values[5] || 0;
          } else {
            this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
          }
        } else if (init && typeof init === 'object') {
          this.a = init.a ?? 1;
          this.b = init.b ?? 0;
          this.c = init.c ?? 0;
          this.d = init.d ?? 1;
          this.e = init.e ?? 0;
          this.f = init.f ?? 0;
        } else {
          this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
        }
      }
      
      multiply(other) {
        return new DOMMatrixPolyfill({
          a: this.a * other.a + this.c * other.b,
          b: this.b * other.a + this.d * other.b,
          c: this.a * other.c + this.c * other.d,
          d: this.b * other.c + this.d * other.d,
          e: this.a * other.e + this.c * other.f + this.e,
          f: this.b * other.e + this.d * other.f + this.f
        });
      }
      
      translate(x, y) {
        return new DOMMatrixPolyfill({
          a: this.a, b: this.b, c: this.c, d: this.d,
          e: this.a * x + this.c * y + this.e,
          f: this.b * x + this.d * y + this.f
        });
      }
      
      scale(x, y = x) {
        return new DOMMatrixPolyfill({
          a: this.a * x, b: this.b * x,
          c: this.c * y, d: this.d * y,
          e: this.e, f: this.f
        });
      }
      
      rotate(angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return new DOMMatrixPolyfill({
          a: this.a * cos + this.c * sin,
          b: this.b * cos + this.d * sin,
          c: this.a * -sin + this.c * cos,
          d: this.b * -sin + this.d * cos,
          e: this.e, f: this.f
        });
      }
      
      invert() {
        const det = this.a * this.d - this.b * this.c;
        if (det === 0) {
          throw new Error('Matrix is not invertible');
        }
        const invDet = 1 / det;
        return new DOMMatrixPolyfill({
          a: this.d * invDet,
          b: -this.b * invDet,
          c: -this.c * invDet,
          d: this.a * invDet,
          e: (this.c * this.f - this.d * this.e) * invDet,
          f: (this.b * this.e - this.a * this.f) * invDet
        });
      }
      
      transformPoint(point) {
        return {
          x: this.a * point.x + this.c * point.y + this.e,
          y: this.b * point.x + this.d * point.y + this.f
        };
      }
    }
    globalThis.DOMMatrix = DOMMatrixPolyfill;
    if (typeof global !== 'undefined') {
      global.DOMMatrix = DOMMatrixPolyfill;
    }
    domMatrixPolyfillLoaded = true;
    console.log('[POLYFILL] DOMMatrix fallback carregado');
  }
}

export { loadDOMMatrixPolyfill };
