// Logical pixels. The projected front and back of the free surface share
// one set of simulation nodes, so the contact lines move together on drag.
vec4 geminiLiquid(vec2 pixel) {
  vec2 size = uResolution / uPixelRatio;
  vec2 p = pixel / uPixelRatio;
  vec2 halfSize = size * 0.5;
  vec2 local = p - halfSize;
  float radius = min(18.0, min(halfSize.x, halfSize.y) * 0.45);
  float wall = -roundedRectSdf(local, halfSize, radius);
  float coverage = smoothstep(-0.5, 0.65, wall);
  float x = clamp((p.x - 5.0) / max(size.x - 10.0, 1.0), 0.0, 1.0);
  float lateral = 2.0 * x - 1.0;
  float chord = sqrt(max(0.0, 1.0 - lateral * lateral));
  float floorY = size.y - 6.0;
  float level = saturate(uRemaining / 100.0);
  float idleY = mix(floorY, 4.0, level);
  float headroom = min(idleY - 4.0, floorY - idleY);
  float wave = clamp(freeSurfaceOffset(x), -headroom, headroom);
  float waterY = idleY + wave;
  float halfDepth = min(6.5, headroom * 0.4) * chord;
  float front = waterY + halfDepth;
  float back = waterY - halfDepth;
  float basin = smoothstep(3.0, 5.5, wall);
  float lightSide = mix(1.0, 0.56, x);

  vec3 color = chamberColor(p / size) * vec3(0.95, 0.87, 1.14);
  color += vec3(0.04, 0.058, 0.09) * chord * (1.0 - smoothstep(0.0, size.y, p.y));
  if (level > 0.0) {
    float fill = smoothstep(back - 0.6, back + 0.6, p.y) * basin;
    float depth = saturate((p.y - front) / max(1.0, floorY - front));
    vec3 transmission = exp(-uAbsorption * (0.24 + chord * 0.6 + depth * 0.45));
    vec3 body = color * transmission + mix(uMiddle, uDeep, depth * 0.82);
    // The light crosses a longer path through the middle of the reservoir.
    body *= 0.70 + 0.36 * transmission;
    float shoulder = exp(-abs(wall - 12.0) * 0.18);
    body += uMiddle * shoulder * lightSide * (0.48 + depth * 0.38);
    // Light converges on the curved inner floor; the band follows the well,
    // including its bottom corners, rather than running across the frame.
    float floorLight = smoothstep(0.5, 0.93, p.y / size.y);
    float focus = exp(-pow(abs(wall - 7.2) / 2.6, 2.0));
    body += uAccent * focus * (0.22 + 0.48 * floorLight) * lightSide;
    float rayY = floorY - 5.0 - chord * (7.0 + 6.0 * sin(x * 7.8 + uPhaseOffset + uFlowOffset.x));
    float floorRay = exp(-abs(p.y - rayY) * 0.38);
    body += uAccent * floorRay * (0.12 + 0.25 * chord);
    float focusX = x - 0.72 - 0.15 * depth;
    body += uMiddle * exp(-focusX * focusX * 42.0) * depth * 0.35;
    float face = 1.0 - smoothstep(front - 0.6, front + 0.6, p.y);
    float faceDepth = saturate((p.y - back) / max(1.0, front - back));
    vec3 surface = mix(uDeep, uMiddle, 0.32 + 0.45 * chord);
    surface += uAccent * (0.22 * (1.0 - faceDepth) + shoulder * 0.30);
    body = mix(body, surface, face);
    float backLine = exp(-abs(p.y - back) * 1.05);
    float frontLine = exp(-abs(p.y - front) * 1.25);
    float glint = exp(-pow(abs(x - 0.24) / 0.13, 2.0)) + exp(-pow(abs(x - 0.86) / 0.12, 2.0));
    body += (uTop * backLine * 0.53 + uTop * frontLine * (0.66 + 0.36 * glint))
      * smoothstep(0.0, 2.0, headroom);
    color = mix(color, body, fill);
  }
  // The dark return and two unequal reflections describe a rolled glass wall.
  color *= 1.0 - 0.42 * exp(-pow(abs(wall - 4.0) / 1.4, 2.0));
  color += vec3(0.63, 0.76, 0.89) * exp(-abs(wall - 1.45) * 1.2) * lightSide * 0.66;
  color += mix(vec3(0.35, 0.46, 0.55), uAccent, 0.33)
    * exp(-abs(wall - 6.2) * 0.82) * (0.25 + 0.24 * lightSide);
  return vec4(color * coverage, coverage);
}
