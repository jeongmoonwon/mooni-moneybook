// 햄스터 캐릭터(Lv.1~6)와 앱 아이콘 SVG를 만든다. 테두리 없는 파스텔 동글이 + 점 눈 + 작은 입 + 볼터치.
// node tools/draw-hamsters.mjs → img/hamster-1~6.svg, tools/icon.svg, tools/icon-maskable.svg
import { writeFileSync } from 'node:fs';

const C = { body: '#F2BF8B', ear: '#F5A79B', tummy: '#FFF3E2', ink: '#4A3730', blush: '#F7A99B', coin: '#FFD46B', coinDark: '#F2B94A',
  jar: '#DDEFF0', jarRim: '#C4E3E6', leaf: '#9ED39B', pink: '#F7A8BE', gold: '#FFCB4F', spark: '#FFD86E' };

const sparkle = (x, y, s, c = C.spark) => `<path d="M${x} ${y - s}Q${x + s * .22} ${y - s * .22} ${x + s} ${y}Q${x + s * .22} ${y + s * .22} ${x} ${y + s}Q${x - s * .22} ${y + s * .22} ${x - s} ${y}Q${x - s * .22} ${y - s * .22} ${x} ${y - s}Z" fill="${c}"/>`;
const coin = (x, y, r = 9) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${C.coinDark}"/><circle cx="${x}" cy="${y - 1.5}" r="${r}" fill="${C.coin}"/>`;

// 표정
const EYES = {
  dot: `<circle cx="80" cy="104" r="5.2" fill="${C.ink}"/><circle cx="120" cy="104" r="5.2" fill="${C.ink}"/>`,
  shine: `<circle cx="80" cy="104" r="6.2" fill="${C.ink}"/><circle cx="120" cy="104" r="6.2" fill="${C.ink}"/><circle cx="82" cy="101.5" r="2" fill="#fff"/><circle cx="122" cy="101.5" r="2" fill="#fff"/>`,
  happy: `<path d="M73 106q7-9 14 0M113 106q7-9 14 0" fill="none" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/>`,
};
const MOUTH = {
  small: `<path d="M95 116q5 3.5 10 0" fill="none" stroke="${C.ink}" stroke-width="3.2" stroke-linecap="round"/>`,
  smile: `<path d="M92 115q8 7 16 0" fill="none" stroke="${C.ink}" stroke-width="3.4" stroke-linecap="round"/>`,
  w: `<path d="M90 115q5 6 10 0q5 6 10 0" fill="none" stroke="${C.ink}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  open: `<path d="M90 113h20q0 13-10 13t-10-13z" fill="${C.ink}"/><path d="M94 122.5q6-4.5 12 0q-2.5 3.5-6 3.5t-6-3.5z" fill="#F38C8C"/>`,
  big: `<path d="M86 112h28q0 19-14 19t-14-19z" fill="${C.ink}"/><path d="M92 126q8-6 16 0q-3.5 5-8 5t-8-5z" fill="#F38C8C"/>`,
};

// 머리 장식
const HAT = {
  sprout: `<path d="M100 44v-12" stroke="${C.leaf}" stroke-width="4" stroke-linecap="round"/><path d="M100 34q-14-2-16-14q14 0 16 14z" fill="${C.leaf}"/>`,
  sprout2: `<path d="M100 44v-14" stroke="${C.leaf}" stroke-width="4" stroke-linecap="round"/><path d="M100 33q-15-1-18-14q15-1 18 14z" fill="${C.leaf}"/><path d="M100 31q13-3 18-15q-15-2-18 15z" fill="#8CC98A"/>`,
  flower: `<g transform="translate(128 44)">${[0, 72, 144, 216, 288].map(a => `<ellipse cx="0" cy="-8" rx="6" ry="8" fill="${C.pink}" transform="rotate(${a})"/>`).join('')}<circle r="5.5" fill="#FFE08A"/></g>`,
  ribbon: `<g transform="translate(100 40)"><path d="M0 0q-20-16-24-2q-2 12 24 2zM0 0q20-16 24-2q2 12-24 2z" fill="${C.pink}"/><circle r="6" fill="#F28FAB"/></g>`,
  wreath: `<g>${[[62, 52], [78, 42], [100, 38], [122, 42], [138, 52]].map(([x, y], i) => `<ellipse cx="${x}" cy="${y}" rx="8" ry="5" fill="${C.leaf}" transform="rotate(${-30 + i * 15} ${x} ${y})"/>`).join('')}
    ${[[70, 46, C.pink], [100, 37, '#FFFFFF'], [130, 46, '#FFE08A']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="6.5" fill="${c}"/><circle cx="${x}" cy="${y}" r="2.5" fill="#F2B94A"/>`).join('')}</g>`,
  crown: `<path d="M74 46l6-26 13 15 7-20 7 20 13-15 6 26z" fill="${C.gold}"/><rect x="74" y="42" width="52" height="8" rx="4" fill="#F5B83A"/><circle cx="100" cy="30" r="3.5" fill="#FF8FA3"/>`,
};

// 몸통 + 귀 + 볼, 그리고 앞에 든 저금병(fill: 0~1, 넘치면 동전이 위로 쌓임)
function hamster({ eyes, mouth, hat = '', fill, extra = '', over = false }) {
  const jarTop = 146, jarBot = 190, h = (jarBot - jarTop - 6) * fill, top = jarBot - 4 - h;
  return `<g>
  <circle cx="58" cy="62" r="17" fill="${C.body}"/><circle cx="142" cy="62" r="17" fill="${C.body}"/>
  <circle cx="58" cy="62" r="9" fill="${C.ear}"/><circle cx="142" cy="62" r="9" fill="${C.ear}"/>
  <path d="M100 46c44 0 74 30 74 74c0 44-30 70-74 70s-74-26-74-70c0-44 30-74 74-74z" fill="${C.body}"/>
  <ellipse cx="100" cy="150" rx="46" ry="34" fill="${C.tummy}" opacity=".55"/>
  <ellipse cx="68" cy="119" rx="11" ry="7" fill="${C.blush}" opacity=".75"/><ellipse cx="132" cy="119" rx="11" ry="7" fill="${C.blush}" opacity=".75"/>
  ${EYES[eyes]}${MOUTH[mouth]}${hat}
  <ellipse cx="72" cy="190" rx="15" ry="8" fill="${C.body}"/><ellipse cx="128" cy="190" rx="15" ry="8" fill="${C.body}"/>
  <defs><clipPath id="jar"><path d="M74 ${jarTop}h52q10 0 10 12v20q0 12-12 12h-48q-12 0-12-12v-20q0-12 10-12z"/></clipPath></defs>
  <path d="M74 ${jarTop}h52q10 0 10 12v20q0 12-12 12h-48q-12 0-12-12v-20q0-12 10-12z" fill="${C.jar}" opacity=".92"/>
  <g clip-path="url(#jar)">${fill > 0 ? `<rect x="60" y="${top}" width="80" height="${jarBot - top}" fill="${C.coin}"/><path d="M60 ${top}q10-6 20 0t20 0t20 0t20 0v4h-80z" fill="${C.coinDark}" opacity=".5"/>` : ''}
    ${fill === 0 ? coin(100, 180, 7) : ''}</g>
  <rect x="78" y="${jarTop - 7}" width="44" height="10" rx="5" fill="${C.jarRim}"/>
  <path d="M74 160q0-7 5-9" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none" opacity=".8"/>
  ${over ? coin(88, 143, 7) + coin(111, 142, 7) + coin(99, 138, 7) : ''}
  <ellipse cx="68" cy="164" rx="10" ry="11" fill="${C.body}"/><ellipse cx="132" cy="164" rx="10" ry="12" fill="${C.body}"/>
  ${extra}</g>`;
}

const LEVELS = [
  { eyes: 'dot', mouth: 'small', hat: HAT.sprout, fill: 0 },
  { eyes: 'dot', mouth: 'smile', hat: HAT.sprout2, fill: 0.25 },
  { eyes: 'dot', mouth: 'w', hat: HAT.flower, fill: 0.45, extra: sparkle(166, 112, 6) },
  { eyes: 'happy', mouth: 'smile', hat: HAT.ribbon, fill: 0.65, extra: sparkle(34, 100, 7) + sparkle(168, 104, 6) },
  { eyes: 'shine', mouth: 'open', hat: HAT.wreath, fill: 0.85, extra: sparkle(30, 96, 8) + sparkle(172, 92, 7) + sparkle(176, 150, 5) },
  { eyes: 'happy', mouth: 'big', hat: HAT.crown, fill: 1, over: true,
    extra: sparkle(28, 92, 9) + sparkle(174, 86, 8) + sparkle(30, 150, 6) + sparkle(176, 152, 6) + coin(26, 188, 8) + coin(176, 186, 8) + sparkle(46, 34, 6) + sparkle(156, 30, 5) },
];

const svg = (inner, bg = '', vb = '0 0 200 200') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${bg}${inner}</svg>\n`;
LEVELS.forEach((lv, i) => writeFileSync(new URL(`../img/hamster-${i + 1}.svg`, import.meta.url), svg(hamster(lv))));

// 앱 아이콘: 크림색 바탕 + Lv.2 새싹 햄스터. 마스커블은 안전 영역(가운데 80%) 안으로 작게
const icon = LEVELS[1];
writeFileSync(new URL('icon.svg', import.meta.url), svg(`<g transform="translate(10 14) scale(.9)">${hamster(icon)}</g>`, '<rect width="200" height="200" fill="#FFF1DC"/>'));
writeFileSync(new URL('icon-maskable.svg', import.meta.url), svg(`<g transform="translate(30 32) scale(.7)">${hamster(icon)}</g>`, '<rect width="200" height="200" fill="#FFF1DC"/>'));
