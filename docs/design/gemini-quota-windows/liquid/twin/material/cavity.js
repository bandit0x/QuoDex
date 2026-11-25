// Draw the cavity in its own coordinates so every highlight follows its wall.
function draw(canvas, amount, time, stir) {
  const c = canvas.getContext('2d');
  const narrow = !!canvas.closest('.tn-cavity');
  const violet = canvas.dataset.source === 'partner';
  c.save();
  c.scale(canvas.width / 120, canvas.height / 70);
  c.clearRect(0, 0, 120, 70);
  const hull = new Path2D(narrow
    ? 'M15 0 Q8 0 5 4 Q0 7 0 17 L0 43 C0 61 20 70 47 70 L73 70 C100 70 120 61 120 43 L120 17 Q120 0 105 0 Z'
    : 'M60 0 C94 0 120 13 120 35 C120 56 94 70 60 70 C26 70 0 56 0 35 C0 13 26 0 60 0 Z');
  c.clip(hull);
  function gradient(brush, stops) {
    for (const [at, color] of stops) brush.addColorStop(at, color);
    return brush;
  }
  c.fillStyle = gradient(c.createRadialGradient(46,54,1,57,36,68),
    [[0,'#304656'],[.68,'#132431'],[.9,'#0b1721'],[1,'#475967']]);
  c.fillRect(0,0,120,70);
  const level = Math.max(0, Math.min(1, (amount ?? 0) / 100));
  if (level > 0) {
    const y = 70 * (1 - level);
    const wobble = Math.sin(time * .013) * stir * 2;
    const wave = new Path2D();
    wave.moveTo(-2,y-2);
    wave.bezierCurveTo(23,y+3+wobble,84,y+4-wobble,122,y-2);
    const body = new Path2D(wave);
    body.lineTo(122,72); body.lineTo(-2,72); body.closePath();
    c.fillStyle = gradient(c.createLinearGradient(0,y-2,0,71), violet
      ? [[0,'#ecd7fb'],[.12,'#b784d0'],[.45,'#754b9c'],[.8,'#493267'],[1,'#a483c2']]
      : [[0,'#cff4ff'],[.09,'#78bdeb'],[.35,'#446ea5'],[.78,'#283d70'],[1,'#6589b9']]);
    c.fill(body);
    c.save(); c.clip(body);
    // Refracted light collects on the curved foot and falls off toward the centre.
    for (const [x,radius] of [[17,25],[99,30]]) {
      c.save(); c.translate(x,61); c.scale(1,.32);
      c.fillStyle = gradient(c.createRadialGradient(0,0,0,0,0,radius),
        [[0,violet ? '#f3abffb0' : '#a3e9ffb0'],[.36,violet ? '#cd66ff70' : '#698cff80'],[1,'#ffffff00']]);
      c.fillRect(-radius,-radius,2*radius,2*radius); c.restore();
    }
    c.beginPath(); c.moveTo(7,44); c.bezierCurveTo(15,69,54,69,78,65);
    c.strokeStyle = violet ? '#f4bfff7d' : '#a9dfff88'; c.lineWidth = .7; c.stroke();
    c.strokeStyle = violet ? '#e6bdff70' : '#beeaff66';
    c.lineWidth = 3.2; c.stroke(hull);
    c.restore();
    c.strokeStyle = violet ? '#fbe4ff' : '#c8edff'; c.lineWidth = 1.15; c.stroke(wave);
    c.beginPath(); c.moveTo(-2,y-2);
    c.bezierCurveTo(31,y-5+wobble,86,y-4-wobble,122,y-2);
    c.bezierCurveTo(84,y+4-wobble,23,y+3+wobble,-2,y-2);
    c.fillStyle = gradient(c.createLinearGradient(0,y-4,0,y+3),
      [[0,'#d5ecffad'],[.55,violet ? '#c780d895' : '#789ee7ab'],[1,'#e8faffb0']]);
    c.fill();
  }
  c.strokeStyle = gradient(c.createLinearGradient(16,0,104,70),
    [[0,'#d4f2ff99'],[.33,'#7996ac26'],[.52,'#071018ac'],[.79,'#b4cad755'],[1,'#213b52']]);
  c.lineWidth = 4; c.stroke(hull);
  c.save(); c.translate(2.5,2); c.scale(115/120,66/70);
  c.strokeStyle = gradient(c.createLinearGradient(0,0,105,38),
    [[0,'#c5e5ff93'],[.28,'#d7f2ff66'],[.62,'#ffffff00'],[1,'#c2e1fa45']]);
  c.lineWidth = 1; c.stroke(hull); c.restore();
  c.restore();
}
