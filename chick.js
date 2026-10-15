/* ================= 병아리 그림 (레벨이 오를수록 사는 곳이 바뀐다) =================
   0: 병아리만 (월말 결산용)  1: 알 속  2: 둥지  3: 꽃밭  4: 구름 위  5: 무지개  6: 왕관 */
const CHICK_STAGES = ['병아리', '알 속', '둥지', '꽃밭', '구름 위', '무지개', '왕관'];

const CHICK_LINE = '#EFB02C';
// 병아리 몸 (100×100 기준, 몸 가운데 50,58 · 발끝 y=83)
function chickBody(y = 0, feet = true) {
  return `<g transform="translate(0 ${y})">
    <path d="M47 38C45.5 31 50.5 29.5 51 35C52.5 29.5 57.5 31 54 38Z" fill="#FFD94F" stroke="${CHICK_LINE}" stroke-width="1.4" stroke-linejoin="round"/>
    ${feet ? '<path d="M43 79v4M40.5 83h5M57 79v4M54.5 83h5" stroke="#FF8F3F" stroke-width="2.2" stroke-linecap="round" fill="none"/>' : ''}
    <ellipse cx="29.5" cy="62" rx="5.5" ry="9" transform="rotate(22 29.5 62)" fill="#FBC83A" stroke="${CHICK_LINE}" stroke-width="1.3"/>
    <ellipse cx="70.5" cy="62" rx="5.5" ry="9" transform="rotate(-22 70.5 62)" fill="#FBC83A" stroke="${CHICK_LINE}" stroke-width="1.3"/>
    <ellipse cx="50" cy="58" rx="23" ry="22" fill="#FFD94F" stroke="${CHICK_LINE}" stroke-width="1.5"/>
    <ellipse cx="50" cy="67" rx="14" ry="9.5" fill="#FFEA94"/>
    <ellipse cx="44" cy="44" rx="7" ry="4" transform="rotate(-25 44 44)" fill="#FFF3B8" opacity=".8"/>
    <circle cx="42" cy="53" r="3" fill="#3D2B26"/><circle cx="58" cy="53" r="3" fill="#3D2B26"/>
    <circle cx="43.1" cy="51.9" r="1.1" fill="#fff"/><circle cx="59.1" cy="51.9" r="1.1" fill="#fff"/>
    <ellipse cx="36.5" cy="59" rx="4" ry="2.5" fill="#FF9E8F" opacity=".75"/><ellipse cx="63.5" cy="59" rx="4" ry="2.5" fill="#FF9E8F" opacity=".75"/>
    <path d="M46.5 57.3Q50 55.3 53.5 57.3Q50 62 46.5 57.3Z" fill="#FF8F3F" stroke="#F2762A" stroke-width=".8" stroke-linejoin="round"/>
  </g>`;
}
const sparkle = (x, y, r, c = '#fff') => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${c}"/>`;
const cloud = (x, y, s, c = '#fff') => `<g fill="${c}"><circle cx="${x - 7 * s}" cy="${y}" r="${5 * s}"/><circle cx="${x}" cy="${y - 3 * s}" r="${7 * s}"/><circle cx="${x + 7 * s}" cy="${y}" r="${5 * s}"/><rect x="${x - 7 * s}" y="${y}" width="${14 * s}" height="${5 * s}"/></g>`;
const flower = (x, y, s, c) => `<g><path d="M${x} ${y + 3 * s}v${6 * s}" stroke="#5FA84A" stroke-width="${1.4 * s}" stroke-linecap="round"/>
  ${[0, 72, 144, 216, 288].map(a => `<circle cx="${(x + 3.3 * s * Math.sin(a * Math.PI / 180)).toFixed(2)}" cy="${(y - 3.3 * s * Math.cos(a * Math.PI / 180)).toFixed(2)}" r="${2.7 * s}" fill="${c}"/>`).join('')}
  <circle cx="${x}" cy="${y}" r="${2 * s}" fill="#FFD23F"/></g>`;

function chickScene(stage) {
  switch (stage) {
    case 1: // 알 속: 깨진 알껍데기에서 빼꼼
      return `${chickBody(4, false)}
        <path d="M21 70L27.5 63.5L34 70L40.5 63.5L47 70L53.5 63.5L60 70L66.5 63.5L73 70L79 64L79 73C79 90 67 97 50 97C33 97 21 90 21 73Z" fill="#FFFCF4" stroke="#E6D2BA" stroke-width="1.5" stroke-linejoin="round"/>
        <circle cx="33" cy="82" r="2" fill="#F3E2CB"/><circle cx="62" cy="86" r="2.6" fill="#F3E2CB"/><circle cx="70" cy="76" r="1.5" fill="#F3E2CB"/>
        <path d="M37 37C39 26 61 25 63 36L59 33.5L55 37.5L51 33L47 37.5L43 33.5Z" transform="translate(0 -4) rotate(-14 50 34)" fill="#FFFCF4" stroke="#E6D2BA" stroke-width="1.4" stroke-linejoin="round"/>
        ${sparkle(18, 30, 4.5)}${sparkle(83, 46, 3.5)}`;
    case 2: // 둥지
      return `<ellipse cx="50" cy="75" rx="37" ry="8" fill="#9C6234"/>
        ${chickBody(1, false)}
        <path d="M12 74Q50 86 88 74C86 94 14 94 12 74Z" fill="#C98A52" stroke="#9C6234" stroke-width="1.3" stroke-linejoin="round"/>
        <path d="M19 80Q33 86 47 82M53 86Q67 88 81 80M26 88Q40 92 58 90M10 72l-5-4M90 73l5-3M14 77l-6 1" stroke="#8E5528" stroke-width="1.5" stroke-linecap="round" fill="none"/>
        <path d="M80 18c6-6 14-2 10 4-4 4-10 2-10-4z" fill="#8BC96A"/><path d="M80 18l9 3" stroke="#5FA84A" stroke-width="1"/>
        ${sparkle(20, 26, 4)}`;
    case 3: // 꽃밭
      return `<path d="M0 79Q28 69 54 75T100 72V100H0Z" fill="#A6DA80"/>
        ${chickBody(-5)}
        <path d="M0 88Q40 79 100 89V100H0Z" fill="#88C766"/>
        <path d="M8 79l-2-5M10 79l1-5M92 76l-2-5M94 76l1-5" stroke="#6DB24F" stroke-width="1.4" stroke-linecap="round"/>
        ${flower(14, 76, 1.05, '#FF9CB5')}${flower(86, 79, .95, '#fff')}${flower(25, 91, .8, '#FFB38A')}${flower(74, 92, .85, '#FFC2D4')}${flower(50, 94, .6, '#fff')}
        <g transform="translate(80 26) rotate(-12)"><ellipse cx="-3.5" cy="-2" rx="4" ry="3.2" fill="#C9B3F5"/><ellipse cx="3.5" cy="-2" rx="4" ry="3.2" fill="#C9B3F5"/>
          <ellipse cx="-2.8" cy="2.6" rx="2.6" ry="2" fill="#B49BEF"/><ellipse cx="2.8" cy="2.6" rx="2.6" ry="2" fill="#B49BEF"/><path d="M0-4v8" stroke="#6E544B" stroke-width="1.2" stroke-linecap="round"/></g>`;
    case 4: // 구름 위
      return `${cloud(19, 24, .9)}${cloud(80, 34, .7)}${sparkle(86, 14, 3.5, '#FFE27A')}${sparkle(12, 46, 3, '#FFE27A')}${sparkle(66, 18, 2.2, '#fff')}
        ${chickBody(-8)}
        <g fill="#fff"><circle cx="20" cy="88" r="13"/><circle cx="38" cy="80" r="13"/><circle cx="60" cy="80" r="14"/><circle cx="80" cy="87" r="13"/><circle cx="6" cy="96" r="10"/><circle cx="96" cy="96" r="10"/><rect x="0" y="86" width="100" height="14"/></g>`;
    case 5: // 무지개
      return `${['#FF9A9A', '#FFC56E', '#FFE67E', '#A2DB8C', '#8FC9F2', '#BCA6F2'].map((c, i) => { const r = 44 - i * 5.5; return `<path d="M${50 - r} 80A${r} ${r} 0 0 1 ${50 + r} 80" stroke="${c}" stroke-width="5.6" fill="none"/>`; }).join('')}
        ${sparkle(14, 18, 3.5)}${sparkle(88, 16, 4)}
        ${chickBody(-6)}
        <g fill="#fff"><circle cx="8" cy="80" r="9"/><circle cx="18" cy="84" r="8"/><circle cx="92" cy="80" r="9"/><circle cx="82" cy="84" r="8"/>
          <circle cx="30" cy="92" r="10"/><circle cx="50" cy="90" r="11"/><circle cx="70" cy="92" r="10"/><rect x="0" y="84" width="100" height="16"/></g>`;
    case 6: // 왕관
      return `<circle cx="50" cy="56" r="44" fill="#FFF3C4" opacity=".55"/>
        <path d="M30 52Q50 44 70 52L82 90Q50 97 18 90Z" fill="#E8566B" stroke="#C93E55" stroke-width="1.3" stroke-linejoin="round"/>
        <path d="M18 90Q50 97 82 90" stroke="#FFD86B" stroke-width="3" fill="none" stroke-linecap="round"/>
        ${chickBody(4)}
        <path d="M37 43L35 26L43.5 34L50 21L56.5 34L65 26L63 43Q50 46 37 43Z" fill="#FFC93C" stroke="#E39B12" stroke-width="1.4" stroke-linejoin="round"/>
        <circle cx="35" cy="26" r="2.2" fill="#FFE68E" stroke="#E39B12" stroke-width="1"/><circle cx="50" cy="21" r="2.4" fill="#FFE68E" stroke="#E39B12" stroke-width="1"/><circle cx="65" cy="26" r="2.2" fill="#FFE68E" stroke="#E39B12" stroke-width="1"/>
        <circle cx="50" cy="37" r="2.6" fill="#FF6B8B"/><circle cx="42.5" cy="39" r="1.7" fill="#6BB8FF"/><circle cx="57.5" cy="39" r="1.7" fill="#6BB8FF"/>
        ${sparkle(15, 22, 6)}${sparkle(86, 18, 5)}${sparkle(87, 62, 3.5)}${sparkle(12, 66, 3.5)}`;
    default: // 병아리만
      return `<ellipse cx="50" cy="84" rx="17" ry="3" fill="#000" opacity=".07"/>${chickBody(0)}`;
  }
}
function chickArt(stage) {
  return `<svg viewBox="0 0 100 100" role="img" aria-label="${CHICK_STAGES[stage] || CHICK_STAGES[0]} 병아리">${chickScene(stage)}</svg>`;
}
