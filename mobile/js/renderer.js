// Rendu WebGL : recadrage, rotation, miroir et réglages colorimétriques.
// Le même shader sert à l'aperçu et à l'export -> ce que tu vois = ce que tu exportes.

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 u_rect;
uniform float u_rot;
uniform float u_flip;
uniform vec2 u_texel;
uniform float u_exposure;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_saturation;
uniform float u_vibrance;
uniform float u_temp;
uniform float u_tint;
uniform float u_sharpen;
uniform float u_vignette;
uniform float u_fade;
uniform float u_hasTex;

vec2 toRaw(vec2 o) {
  if (u_flip > 0.5) o.x = 1.0 - o.x;
  if (u_rot > 2.5) return vec2(1.0 - o.y, o.x);
  if (u_rot > 1.5) return vec2(1.0 - o.x, 1.0 - o.y);
  if (u_rot > 0.5) return vec2(o.y, 1.0 - o.x);
  return o;
}

void main() {
  vec2 o = u_rect.xy + v_uv * u_rect.zw;
  if (u_hasTex < 0.5 || o.x < 0.0 || o.y < 0.0 || o.x > 1.0 || o.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 r = toRaw(o);
  vec3 c = texture2D(u_tex, r).rgb;

  if (u_sharpen > 0.0) {
    vec3 n = texture2D(u_tex, r + vec2(u_texel.x, 0.0)).rgb
           + texture2D(u_tex, r - vec2(u_texel.x, 0.0)).rgb
           + texture2D(u_tex, r + vec2(0.0, u_texel.y)).rgb
           + texture2D(u_tex, r - vec2(0.0, u_texel.y)).rgb;
    c = c + u_sharpen * (c - n * 0.25);
  }
  c = max(c, 0.0);

  // Exposition (en diaphs)
  c *= exp2(u_exposure);

  // Balance des blancs
  c.r *= 1.0 + u_temp * 0.18;
  c.b *= 1.0 - u_temp * 0.18;
  c.g *= 1.0 - u_tint * 0.12;

  // Hautes lumières / ombres
  float l = dot(clamp(c, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
  float ws = pow(1.0 - l, 3.0);
  float wh = pow(l, 3.0);
  c += u_shadows * 0.35 * ws + u_highlights * 0.35 * wh;

  // Luminosité (courbe gamma, préserve noirs et blancs)
  c = pow(clamp(c, 0.0, 1.0), vec3(exp2(-u_brightness)));

  // Contraste
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;

  // Saturation / vibrance
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.0 + u_saturation);
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  c = mix(vec3(l), c, 1.0 + u_vibrance * (1.0 - clamp(mx - mn, 0.0, 1.0)));

  // Vignettage
  if (u_vignette > 0.0) {
    float d = length(v_uv - 0.5) * 1.4142;
    c *= 1.0 - u_vignette * 0.85 * smoothstep(0.35, 1.05, d);
  }

  gl_FragColor = vec4(clamp(c, 0.0, 1.0) * u_fade, 1.0);
}`;

const UNIFORMS = ['u_tex', 'u_rect', 'u_rot', 'u_flip', 'u_texel', 'u_exposure', 'u_brightness', 'u_contrast',
  'u_highlights', 'u_shadows', 'u_saturation', 'u_vibrance', 'u_temp', 'u_tint', 'u_sharpen', 'u_vignette',
  'u_fade', 'u_hasTex'];

export class Renderer {
  constructor(canvas, { preserveDrawingBuffer = false } = {}) {
    this.canvas = canvas;
    const opts = { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer, powerPreference: 'high-performance' };
    let gl = canvas.getContext('webgl2', opts);
    this.isGL2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('WebGL indisponible sur cet appareil.');
    this.gl = gl;

    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.u = {};
    for (const n of UNIFORMS) this.u[n] = gl.getUniformLocation(prog, n);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.uniform1i(this.u.u_tex, 0);
    this.hasTex = false;
  }

  resize(w, h) {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  // source : HTMLVideoElement | VideoFrame | canvas ; rawW/rawH : taille brute de la texture.
  upload(source, rawW, rawH) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.rawW = rawW;
    this.rawH = rawH;
    this.hasTex = true;
    // Mipmaps (WebGL2) pour un sous-échantillonnage propre (ex. 4K -> 720p).
    const down = Math.max(rawW / this.canvas.width, rawH / this.canvas.height);
    if (this.isGL2 && down > 1.6) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
  }

  clearTexture() { this.hasTex = false; }

  // p : { rect, rot (quarts de tour horaires), flip, adjust, fade }
  draw(p) {
    const gl = this.gl, u = this.u;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const a = p.adjust || {};
    const n = k => (a[k] || 0) / 100;
    const rect = p.rect || { x: 0, y: 0, w: 1, h: 1 };
    gl.uniform4f(u.u_rect, rect.x, rect.y, rect.w, rect.h);
    gl.uniform1f(u.u_rot, ((p.rot || 0) % 4 + 4) % 4);
    gl.uniform1f(u.u_flip, p.flip ? 1 : 0);
    gl.uniform2f(u.u_texel, 1 / (this.rawW || 1), 1 / (this.rawH || 1));
    gl.uniform1f(u.u_exposure, n('exposure') * 2);
    gl.uniform1f(u.u_brightness, n('brightness') * 0.8);
    const c = n('contrast');
    gl.uniform1f(u.u_contrast, c > 0 ? c : c * 0.8);
    gl.uniform1f(u.u_highlights, n('highlights'));
    gl.uniform1f(u.u_shadows, n('shadows'));
    gl.uniform1f(u.u_saturation, n('saturation'));
    gl.uniform1f(u.u_vibrance, n('vibrance'));
    gl.uniform1f(u.u_temp, n('temperature'));
    gl.uniform1f(u.u_tint, n('tint'));
    gl.uniform1f(u.u_sharpen, n('sharpen') * 1.5);
    gl.uniform1f(u.u_vignette, n('vignette'));
    gl.uniform1f(u.u_fade, p.fade == null ? 1 : p.fade);
    gl.uniform1f(u.u_hasTex, this.hasTex && p.hasTex !== false ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  drawBlack() {
    this.draw({ hasTex: false });
  }
}
