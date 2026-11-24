import "@testing-library/jest-dom/vitest";

// jsdom has neither an image decoder nor a canvas renderer.
Object.defineProperty(HTMLImageElement.prototype, "decode", {
  configurable: true,
  value: async () => undefined,
});

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: () => null,
});
