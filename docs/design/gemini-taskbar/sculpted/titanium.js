(() => {
  // The fold and the cut edge have separate normals. Each instance gets its own
  // paint servers so reflections stay local to the mark when several are shown.
  function folded(outline, palette, faces, polish) {
    const { edge, dark, mid, light, white } = palette;
    return `
      <defs>
        <linearGradient id="__ID__-sheet" x1="4" y1="3" x2="25" y2="28" gradientUnits="userSpaceOnUse">
          <stop stop-color="${light}"/><stop offset=".23" stop-color="${white}"/>
          <stop offset=".35" stop-color="${mid}"/><stop offset=".70" stop-color="${dark}"/>
          <stop offset="1" stop-color="${light}"/>
        </linearGradient>
        <linearGradient id="__ID__-return" x1="26" y1="3" x2="7" y2="30" gradientUnits="userSpaceOnUse">
          <stop stop-color="${dark}"/><stop offset=".45" stop-color="${mid}"/>
          <stop offset=".62" stop-color="${white}"/><stop offset="1" stop-color="${mid}"/>
        </linearGradient>
        <clipPath id="__ID__-edge"><path d="${outline}"/></clipPath>
      </defs>
      <path d="${outline}" fill="${edge}" stroke="${edge}" stroke-width="1.15" stroke-linejoin="round"/>
      <g clip-path="url(#__ID__-edge)">
        <path d="${outline}" fill="url(#__ID__-sheet)"/>
        ${faces}
        <path d="${polish}" fill="none" stroke="${white}" stroke-opacity=".8" stroke-width=".57" stroke-linejoin="round"/>
        <path class="glint" d="M-14 38 8-5h3L-11 38z" fill="white" opacity="0"/>
      </g>`;
  }

  const ice = { edge: "#152f42", dark: "#2e5873", mid: "#6993ac", light: "#b6d9e8", white: "#edfcff" };
  const brass = { edge: "#453121", dark: "#775436", mid: "#b78b56", light: "#eed2a1", white: "#fff5d6" };
  const iris = { edge: "#312b47", dark: "#665678", mid: "#a08ea9", light: "#e0cde4", white: "#fdf3fd" };
  const codex = folded(
    "M2.6 10.6 13.1 2.9 24.2 4.7 29.2 10.4 20 10.1 14.4 8.1 8.9 12.5 8.4 19.4 14.8 24 20.3 21 28.9 20.1 24.4 26.1 14.3 30 2.2 22.4Z",
    ice,
    `<path d="m2.6 10.6 6.3 1.9 5.5-4.4-1.3-5.2z" fill="url(#__ID__-return)"/>
     <path d="m13.1 2.9 8.5 4.2 7.6 3.3-5-5.7z" fill="#c4e1ed"/>
     <path d="m21.6 7.1-1.6 3 9.2.3z" fill="#37576c"/>
     <path d="m2.6 10.6 2.9 9.6 2.9-.8.5-6.9z" fill="#416c87"/>
     <path d="m2.2 22.4 3.3-2.2 9.3 3.8-.5 6z" fill="url(#__ID__-return)"/>
     <path d="m14.3 30 .5-6 14.1-3.9-4.5 6z" fill="url(#__ID__-sheet)"/>
     <path d="m20.3 21 8.6-.9-14.1 3.9z" fill="#daeaf0"/>`,
    "m2.6 10.6 10.5-7.7 8.5 4.2m-16.1 13.1 9.3 3.8 14.1-3.9"
  );
  const zcode = folded(
    "M5 4.8 28.2 3.2 25.6 11.1 12.4 22.2 29.5 19.4 26 27.7 2.6 29 5.9 20.6 18.8 10.5 2.6 12.5Z",
    brass,
    `<path d="M5 4.8 28.2 3.2 18.8 7.2 2.6 12.5Z" fill="#e6c898"/>
     <path d="m2.6 12.5 16.2-5.3v3.3z" fill="#735336"/>
     <path d="M28.2 3.2 25.6 11.1 6.9 24.8 18.8 10.5V7.2Z" fill="url(#__ID__-return)"/>
     <path d="M5.9 20.6 25.6 7.2 6.9 24.8 2.6 29Z" fill="#a37950"/>
     <path d="m6.9 24.8 5.5-2.6 17.1-2.8-5.6 5.3z" fill="url(#__ID__-sheet)"/>
     <path d="m2.6 29 4.3-4.2 17-.1 5.6-5.3-3.5 8.3z" fill="url(#__ID__-return)"/>`,
    "m5 4.8 23.2-1.6-9.4 4m6.8 3.9L6.9 24.8l17-.1"
  );
  const gemini = folded(
    "M1.5 3.6 11.9 8.2 16 13.3 20.1 8.2 30.5 3.6 27.3 19.1 19.9 27.9 16 21.2 12.1 27.9 4.7 19.1Z",
    iris,
    `<path d="M1.5 3.6 11.9 8.2 16 13.3 8.4 11.6Z" fill="url(#__ID__-return)"/>
     <path d="m1.5 3.6 6.9 8 3.7 16.3-7.4-8.8z" fill="url(#__ID__-sheet)"/>
     <path d="M8.4 11.6 16 16.8v4.4l-3.9 6.7z" fill="#584c6a"/>
     <path d="m30.5 3.6-10.4 4.6-4.1 5.1 7.6-1.7z" fill="#ded0e3"/>
     <path d="m30.5 3.6-6.9 8-3.7 16.3 7.4-8.8z" fill="url(#__ID__-return)"/>
     <path d="M23.6 11.6 16 16.8v4.4l3.9 6.7z" fill="url(#__ID__-sheet)"/>
     <path d="m16 13.3 7.6-1.7-7.6 5.2-7.6-5.2z" fill="#84738e"/>`,
    "m1.5 3.6 6.9 8 3.7 16.3m18.4-24.3-6.9 8-7.6 5.2"
  );
  window.markFamilies ??= {};
  window.markFamilies.titanium = { codex, zcode, gemini };
})();
