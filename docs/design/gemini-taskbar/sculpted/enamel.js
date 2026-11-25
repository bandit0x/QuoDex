// Cloisonné objects. Each inset is bounded by a wire, and the desktop is
// visible right up to the silhouette. The renderer supplies a unique ID.
(() => {
  const brass = `
    <linearGradient id="__ID__wire" x1="0" y1="0" x2=".72" y2="1">
      <stop stop-color="#fff2be"/><stop offset=".29" stop-color="#c8a366"/>
      <stop offset=".48" stop-color="#fff0be"/><stop offset=".72" stop-color="#ad793b"/>
      <stop offset="1" stop-color="#efd399"/>
    </linearGradient>`;
  window.markFamilies.enamel = {
    codex: `
      <defs>${brass}
        <radialGradient id="__ID__leaf" cx=".32" cy=".08" r=".95">
          <stop stop-color="#a0e6dc"/><stop offset=".23" stop-color="#338e96"/>
          <stop offset=".58" stop-color="#126274"/><stop offset=".88" stop-color="#173e58"/>
          <stop offset="1" stop-color="#2f7380"/>
        </radialGradient>
        <linearGradient id="__ID__fold" x1=".16" y1=".01" x2=".88" y2="1">
          <stop stop-color="#164454"/><stop offset=".47" stop-color="#416e80"/>
          <stop offset=".67" stop-color="#29516a"/><stop offset="1" stop-color="#0d263c"/>
        </linearGradient>
      </defs>
      <g stroke-linejoin="round" stroke-linecap="round">
        <path d="M2.15 6.55Q8.7 4.1 15.75 8.45Q21.4 3.4 29.75 3.6L29.2 23.15Q21.4 23 16.15 28.3Q9.7 23.7 2.15 24.8Z" fill="#735a37" stroke="#443a2f" stroke-width="1.45"/>
        <path d="M2.7 6.9Q9.25 5.15 15.7 9.65L15.9 25.85Q9.9 21.35 3.3 22.55Z" fill="url(#__ID__leaf)" stroke="url(#__ID__wire)" stroke-width="1.2"/>
        <path d="M15.7 9.65Q21.75 4.4 29.25 4.4L28.25 20.8Q21.45 20.95 15.9 25.85Z" fill="url(#__ID__fold)" stroke="url(#__ID__wire)" stroke-width="1.2"/>
        <path d="M6.8 11.85 10.25 15.4 7.1 18.15M20.05 16.9 24.45 15.25" fill="none" stroke="#dae9cf" stroke-width="1.8"/>
        <path d="M4.35 7.75Q7.95 7.1 11 8.65M19 8.95Q22.35 6.6 25.3 6" fill="none" stroke="#d4fff0" stroke-width=".78"/>
        <path class="glint" d="M16.2 24.8Q21.85 20.6 27.1 20.3" fill="none" stroke="#fff6c8" stroke-width="1.35"/>
      </g>`,
    zcode: `
      <defs>${brass}
        <linearGradient id="__ID__amber" x1=".26" y1="0" x2=".66" y2="1">
          <stop stop-color="#ffe7a8"/><stop offset=".18" stop-color="#d29a48"/>
          <stop offset=".42" stop-color="#a95a28"/><stop offset=".61" stop-color="#efb659"/>
          <stop offset=".81" stop-color="#9b4c27"/><stop offset="1" stop-color="#683c29"/>
        </linearGradient>
        <path id="__ID__upper" d="M7.8 17.6 3.9 12.4Q2.9 11 4.05 9.55L8.85 4.35Q9.8 3.4 11.2 3.7L18.5 5.6Q20.35 6.15 20.25 8.05L19.85 12.65Q19.75 14.15 18.05 14.85L10.75 18.15Q9.1 18.85 7.8 17.6Z"/>
        <path id="__ID__lower" d="m13.9 19 7.6-6.45q1.6-1.25 3.2.1l3.3 3.2q1.35 1.5.4 3.3l-4.3 7.25q-.8 1.4-2.65 1.55l-5.05.15q-1.8.05-2.65-1.55l-1.3-3.65q-.8-2.15 1.45-3.9Z"/>
        <g id="__ID__back">
          <use href="#__ID__upper" stroke="#583a22" stroke-width="5.95"/>
          <use href="#__ID__upper" stroke="url(#__ID__wire)" stroke-width="4.5"/>
          <use href="#__ID__upper" stroke="url(#__ID__amber)" stroke-width="2.65"/>
        </g>
        <clipPath id="__ID__overlap"><path d="M16.8 8h7v8.5h-7z"/></clipPath>
      </defs>
      <g fill="none" stroke-linejoin="round" stroke-linecap="round">
        <use href="#__ID__back"/>
        <use href="#__ID__lower" stroke="#513b29" stroke-width="5.95"/>
        <use href="#__ID__lower" stroke="url(#__ID__wire)" stroke-width="4.5"/>
        <use href="#__ID__lower" stroke="url(#__ID__amber)" stroke-width="2.65"/>
        <use href="#__ID__back" clip-path="url(#__ID__overlap)"/>
        <path d="m7.7 5.4 1.5-1.5q.65-.55 1.85-.25l4.4 1.1m5.05 22.65-3.55.05" stroke="#fff2bc" stroke-width=".9"/>
        <path class="glint" d="M28.25 17.3q.4.8-.3 1.95l-3.7 6.25" stroke="#ffedaf" stroke-width="1.25"/>
      </g>`,
    gemini: `
      <defs>${brass}
        <radialGradient id="__ID__iris" cx=".37" cy=".21" r=".88">
          <stop stop-color="#dfd4f8"/><stop offset=".21" stop-color="#a88bcf"/>
          <stop offset=".5" stop-color="#69509c"/><stop offset=".84" stop-color="#303962"/>
          <stop offset="1" stop-color="#66578f"/>
        </radialGradient>
        <linearGradient id="__ID__petal" x1=".08" y1=".1" x2=".85" y2="1">
          <stop stop-color="#f6d5d5"/><stop offset=".3" stop-color="#c892ba"/>
          <stop offset=".67" stop-color="#925e91"/><stop offset="1" stop-color="#514269"/>
        </linearGradient>
      </defs>
      <g stroke-linejoin="round" stroke-linecap="round">
        <path d="M13.5 1.75Q19.7 7.95 19.9 14L16.65 20.4 13.7 27.2Q6.55 22.45 3.75 16.25Q6.25 8.05 13.5 1.75Z" fill="url(#__ID__iris)" stroke="#443449" stroke-width="1.65"/>
        <path d="M13.45 2.8Q17.9 8.25 18.9 13.8L15.75 20.1 13.4 25.75Q7 21.1 4.75 16.1Q7.15 8.85 13.45 2.8Z" fill="none" stroke="url(#__ID__wire)" stroke-width=".9"/>
        <path d="M13.45 3.2 10.2 14.25 4.95 16.1M10.2 14.25 13.4 25.35" fill="none" stroke="#d7bc98" stroke-width=".85"/>
        <path d="M25 8.35Q28.45 14.25 28.2 20.65Q24.8 26.7 15.8 30Q15.9 22.35 18.45 16.5Q20.7 11.85 25 8.35Z" fill="url(#__ID__petal)" stroke="#503649" stroke-width="1.55"/>
        <path d="M24.85 9.65Q27.4 14.45 27.25 20.45Q23.15 26.1 16.8 28.6Q17.05 21.8 19.25 16.95Q21.6 12.65 24.85 9.65Z" fill="none" stroke="url(#__ID__wire)" stroke-width=".85"/>
        <path d="m24.6 10.7-2.25 9.4-5.15 7.6m5.15-7.6 4.45.3" fill="none" stroke="#e9c0b6" stroke-width=".85"/>
        <path d="m11.95 6.5-2.2 3.95" fill="none" stroke="#f5efff" stroke-width="1.15"/>
        <path class="glint" d="M16.9 27.25 22.25 19.4 24.3 11.7" fill="none" stroke="#fff1ee" stroke-width="1.15"/>
      </g>`,
  };
})();
