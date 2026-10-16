import { FONTS, rng } from './textures.js';

// A typed investigation report clipped inside the cover (the left page of an
// open file). Drawn onto the cover-inner canvas, in the same 180° frame as the
// evidence label (the box's -Y face is seen flipped once open).

function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Slightly uneven typewriter strike: each glyph drifts a fraction of a pixel. */
function typed(ctx, text, x, y, r, ink = 'rgba(28,24,20,0.9)') {
  let cx = x;
  for (const ch of text) {
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.78 + r() * 0.22;
    ctx.fillText(ch, cx, y + (r() - 0.5) * 1.2);
    cx += ctx.measureText(ch).width;
  }
  ctx.globalAlpha = 1;
}

/**
 * report: { caseLabel, caseTitle, levelLabel, title, difficulty, reward, status, description, hint, completed }
 */
export function drawCaseReport(ctx, w, h, report) {
  const r = rng(String(report.levelLabel + report.caseLabel).split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0);
  ctx.save();
  ctx.translate(w, h); ctx.rotate(Math.PI);

  // the sheet, held under the paper clip on the fold side
  const sx = 34, sy = 30, sw = w - 70, sh = h - 270;
  ctx.save();
  ctx.translate(sx + sw / 2, sy + sh / 2); ctx.rotate(-0.012);
  ctx.shadowColor = 'rgba(40,25,10,0.38)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#ece4cf'; ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
  ctx.shadowColor = 'transparent';
  // age the sheet a little
  for (let i = 0; i < 5; i++) {
    const x = (r() - 0.5) * sw, y = (r() - 0.5) * sh, rad = 80 + r() * 200;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(150,110,60,${0.03 + r() * 0.05})`); g.addColorStop(1, 'rgba(150,110,60,0)');
    ctx.fillStyle = g; ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
  }
  ctx.translate(-sw / 2, -sh / 2);

  const pad = 34, maxW = sw - pad * 2;
  ctx.textBaseline = 'alphabetic';
  // header
  ctx.font = `21px ${FONTS.type}`;
  typed(ctx, `INVESTIGATION REPORT · ${report.caseLabel}`, pad, 52, r, 'rgba(110,30,24,0.9)');
  ctx.strokeStyle = 'rgba(60,40,30,0.5)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(pad, 66); ctx.lineTo(sw - pad, 66); ctx.stroke();
  ctx.font = `19px ${FONTS.type}`;
  typed(ctx, report.caseTitle.toUpperCase(), pad, 92, r, 'rgba(60,48,40,0.8)');

  // level heading
  ctx.font = `46px ${FONTS.type}`;
  typed(ctx, report.levelLabel, pad, 152, r);
  ctx.font = `29px ${FONTS.type}`;
  let y = 196;
  for (const line of wrap(ctx, report.title.toUpperCase(), maxW).slice(0, 2)) { typed(ctx, line, pad, y, r); y += 36; }

  // particulars
  y += 8;
  ctx.beginPath(); ctx.setLineDash([6, 5]); ctx.moveTo(pad, y); ctx.lineTo(sw - pad, y); ctx.stroke(); ctx.setLineDash([]);
  y += 38;
  ctx.font = `24px ${FONTS.type}`;
  for (const [k, v] of [['DIFFICULTY', report.difficulty], ['REWARD', report.reward], ['STATUS', report.status]]) {
    typed(ctx, `${k}:`, pad, y, r, 'rgba(70,58,48,0.85)');
    typed(ctx, String(v).toUpperCase(), pad + 196, y, r);
    y += 34;
  }
  y += 10;
  ctx.beginPath(); ctx.setLineDash([6, 5]); ctx.moveTo(pad, y); ctx.lineTo(sw - pad, y); ctx.stroke(); ctx.setLineDash([]);

  // briefing
  y += 40;
  ctx.font = `23px ${FONTS.type}`;
  const lines = wrap(ctx, report.description, maxW);
  const room = Math.floor((sh - y - 60) / 31);
  for (const line of lines.slice(0, room)) { typed(ctx, line, pad, y, r); y += 31; }

  if (report.hint) {
    ctx.font = `20px ${FONTS.type}`;
    typed(ctx, report.hint, pad, sh - 30, r, 'rgba(110,30,24,0.75)');
  }

  // a solved level carries the stamp
  if (report.completed) {
    ctx.save();
    ctx.translate(sw - 170, 150); ctx.rotate(-0.16);
    ctx.strokeStyle = 'rgba(150,24,20,0.82)'; ctx.lineWidth = 5;
    ctx.strokeRect(-128, -36, 256, 72);
    ctx.font = `48px ${FONTS.stencil}`; ctx.fillStyle = 'rgba(150,24,20,0.82)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('VERIFIED', 0, 3);
    ctx.restore();
  }
  ctx.restore();
  ctx.restore();
}
