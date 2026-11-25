(() => {
  // Each optical filament has a dark jacket, a colored core, and an off-axis catchlight.
  // All geometry is open to the desktop, including the spaces inside the terminal gate.
  const profiles = {
    codex: {
      ink: "#11324b", shade: "#24559a", body: "#26abc7", light: "#b5f3ef", tip: "#e9ffff",
      filaments: [
        { path: "M4.2 25.5v-9.6c0-7.2 4.6-11.8 11.8-11.8s11.8 4.6 11.8 11.8v9.6", width: 4.5 },
        { path: "M10.5 24.8v-9.1a5.5 5.5 0 0 1 11 0v3.1l-3.8 3.1", width: 3.35 },
      ],
    },
    zcode: {
      ink: "#4c2d18", shade: "#a0511c", body: "#f49b37", light: "#ffe2a4", tip: "#fff9dc",
      filaments: [
        { path: "M4.3 10.1 6.9 6.8a2.8 2.8 0 0 1 2.2-1h15.3c1.95 0 2.8 2.4 1.22 3.54L7.1 22.9c-1.55 1.15-.77 3.44 1.11 3.44h15.6a2.9 2.9 0 0 0 2.18-1l2.05-2.64", width: 4.8 },
      ],
    },
    gemini: {
      ink: "#4a244f", shade: "#774190", body: "#de74a1", light: "#ffcae6", tip: "#fff1fe",
      filaments: [
        { path: "M7.5 25.2c-3.3-3.08-2.1-10.74 3.72-16.63S23.83 1.42 26.35 4.52c2.79 3.41.73 11.05-4.99 16.72S10.72 28.19 7.5 25.2Z", width: 2.85 },
        { path: "M25.2 25.55c-3.29 2.68-10.68.18-16.15-5.49S1.34 7.81 4.49 5.54c3.44-2.51 10.45.44 16.08 6.18s7.58 11.43 4.63 13.83Z", width: 3.0 },
      ],
      focus: true,
    },
  };

  function guide(profile) {
    const gradient = "__ID__-spectrum";
    const definitions = profile.filaments.map(({path}, i) =>
      '<path id="__ID__-tube-' + i + '" d="' + path + '" pathLength="100"/>').join("");
    const tubes = profile.filaments.map(({width}, i) => {
      const ref = 'href="#__ID__-tube-' + i + '"';
      return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
        <use ${ref} stroke="${profile.light}" stroke-opacity=".7" stroke-width="${width + .75}"/>
        <use ${ref} stroke="${profile.ink}" stroke-width="${width}"/>
        <use ${ref} stroke="url(#${gradient})" stroke-width="${width - 1.25}" transform="translate(-.14 -.2)"/>
        <use ${ref} stroke="${profile.tip}" stroke-width=".64" stroke-opacity=".84" stroke-dasharray="16 11 6 20 17 30" transform="translate(-.46 -.56)"/>
        <use ${ref} class="glint" stroke="#fff" stroke-width="1.5" stroke-dasharray="8 92" opacity="0"/>
      </g>`;
    }).join("");
    const focus = profile.focus ? `<path d="m16 11.85 3.05 4.65L16 20.4l-3-3.9Z" fill="${profile.ink}"/>
      <path d="m16 13.02 2.05 3.2L16 18.9l-1.93-2.68Z" fill="${profile.light}"/>` : "";
    return `<defs><linearGradient id="${gradient}" gradientUnits="userSpaceOnUse" x1="5" y1="2.5" x2="24" y2="29">
        <stop stop-color="${profile.body}"/><stop offset=".19" stop-color="${profile.light}"/>
        <stop offset=".38" stop-color="${profile.body}"/><stop offset=".64" stop-color="${profile.shade}"/>
        <stop offset=".86" stop-color="${profile.light}"/><stop offset="1" stop-color="${profile.body}"/>
      </linearGradient>${definitions}</defs>${tubes}${focus}`;
  }

  window.markFamilies.waveguide = Object.fromEntries(
    Object.entries(profiles).map(([agent, profile]) => [agent, guide(profile)])
  );
})();
