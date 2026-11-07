/* ============================================================
   RAKUTIN — portfolio
   Scene: Three.js (simplex-displaced icosahedron + particle field,
   camera on a Catmull-Rom path driven by scroll)
   Motion: GSAP + ScrollTrigger + Lenis smooth scroll
   ============================================================ */

gsap.registerPlugin(ScrollTrigger);

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const COARSE = matchMedia("(pointer: coarse)").matches;

/* ---------- palette (matches CSS tokens) ---------- */
const COL = {
  bg: new THREE.Color(0x121212),
  body: new THREE.Color(0x1e1e1e),
  lime: new THREE.Color(0xf2f2ef),
  mist: new THREE.Color(0x9a9a94),
  dim: new THREE.Color(0x4a4a46),
};

/* ---------- deterministic RNG (seeded) ---------- */
function mulberry(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry(20251103);

/* ---------- shaders ---------- */
const SNOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const BODY_VERT = `
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
varying float vNoise;
varying vec3 vNormalW;
varying vec3 vPosW;
${SNOISE}
void main(){
  float t = uTime * 0.22;
  float n = snoise(normal * uFreq + vec3(t, t * 0.7, -t * 0.5));
  float n2 = snoise(normal * uFreq * 2.6 - vec3(t * 1.4)) * 0.35;
  vNoise = n + n2;
  vec3 displaced = position + normal * (vNoise * uAmp);
  vec4 world = modelMatrix * vec4(displaced, 1.0);
  vPosW = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const BODY_FRAG = `
uniform vec3 uBody;
uniform vec3 uLime;
uniform vec3 uMist;
uniform float uTime;
varying float vNoise;
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  vec3 V = normalize(cameraPosition - vPosW);
  float fres = pow(1.0 - max(dot(normalize(vNormalW), V), 0.0), 5.0);
  float bands = smoothstep(0.35, 0.9, sin(vNoise * 9.0 + uTime * 0.6) * 0.5 + 0.5);
  vec3 col = uBody;
  col = mix(col, uMist * 0.35, bands * 0.08);
  col = mix(col, uLime, fres * 0.34);
  col += uLime * smoothstep(0.65, 1.0, vNoise) * 0.03;
  gl_FragColor = vec4(col, 1.0);
}`;

const SHELL_FRAG = `
uniform vec3 uLime;
void main(){ gl_FragColor = vec4(uLime, 0.05); }`;

const POINTS_VERT = `
uniform float uTime;
uniform float uPixelRatio;
attribute float aSize;
attribute float aSpeed;
attribute vec3 aColor;
varying vec3 vColor;
varying float vFade;
void main(){
  vec3 p = position;
  float t = uTime * aSpeed;
  p.x += sin(t + position.y * 0.8) * 0.35;
  p.y += cos(t * 0.8 + position.z * 0.6) * 0.35;
  p.z += sin(t * 0.6 + position.x * 0.5) * 0.3;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  vFade = smoothstep(26.0, 6.0, dist);
  vColor = aColor;
  gl_PointSize = aSize * uPixelRatio * (7.0 / dist);
  gl_Position = projectionMatrix * mv;
}`;

const POINTS_FRAG = `
varying vec3 vColor;
varying float vFade;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float a = smoothstep(0.5, 0.05, d) * vFade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a * 0.55);
}`;

/* ---------- WebGL scene ---------- */
function createScene() {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  const pixelRatio = Math.min(devicePixelRatio, COARSE ? 1.5 : 1.75);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.domElement.classList.add("webgl");
  renderer.domElement.setAttribute("aria-hidden", "true");
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = COL.bg;
  scene.fog = new THREE.FogExp2(COL.bg, 0.045);

  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 120);

  // main displaced body
  const bodyUniforms = {
    uTime: { value: 0 },
    uAmp: { value: 0.34 },
    uFreq: { value: 1.35 },
    uBody: { value: COL.body },
    uLime: { value: COL.lime },
    uMist: { value: COL.mist },
  };
  const bodyMat = new THREE.ShaderMaterial({
    vertexShader: BODY_VERT,
    fragmentShader: BODY_FRAG,
    uniforms: bodyUniforms,
  });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1.55, 48), bodyMat);
  scene.add(body);

  // wireframe shell
  const shellMat = new THREE.ShaderMaterial({
    vertexShader: BODY_VERT,
    fragmentShader: SHELL_FRAG,
    uniforms: {
      uTime: bodyUniforms.uTime,
      uAmp: { value: 0.58 },
      uFreq: bodyUniforms.uFreq,
      uLime: { value: COL.lime },
    },
    wireframe: true,
    transparent: true,
    depthWrite: false,
  });
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.72, 9), shellMat);
  scene.add(shell);


  /* ---------- Figma logo: 5 pieces that assemble on hero scroll ---------- */
  /* ---------- motion chromatic aberration (post pass, only while things move) ---------- */
  const rt = new THREE.WebGLRenderTarget(Math.round(innerWidth * pixelRatio), Math.round(innerHeight * pixelRatio), { samples: 4 });
  const postMat = new THREE.ShaderMaterial({
    uniforms: { tDiff: { value: rt.texture }, uAb: { value: 0 }, uDir: { value: new THREE.Vector2() } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiff; uniform float uAb; uniform vec2 uDir; varying vec2 vUv;
void main(){
  vec2 c = vUv - 0.5;
  vec2 d = c * uAb * (0.4 + length(c) * 1.4) + uDir * uAb;
  float r = texture2D(tDiff, vUv + d).r;
  float g = texture2D(tDiff, vUv).g;
  float b = texture2D(tDiff, vUv - d).b;
  gl_FragColor = vec4(r, g, b, 1.0);
}`,
    depthTest: false,
    depthWrite: false,
  });
  const postScene = new THREE.Scene();
  const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
  postQuad.frustumCulled = false;
  postScene.add(postQuad);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  function renderPost() {
    if (postMat.uniforms.uAb.value > 0.0008) {
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
    } else {
      renderer.render(scene, camera);
    }
  }
  const hintEl = document.querySelector(".hw-hint");
  let abE = 0;

  const LOGO_VERT = `
varying vec3 vN;
varying vec3 vP;
varying vec3 vL;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vL = position;
  vP = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
  const LOGO_FRAG = `
uniform vec3 uColor;
uniform float uMix;
uniform float uFlash;
uniform float uCy;
varying vec3 vN;
varying vec3 vP;
varying vec3 vL;
void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vP);
  vec3 L1 = normalize(vec3(-0.45, 0.8, 0.9));
  vec3 L2 = normalize(vec3(0.9, -0.25, 0.45));
  float d1 = max(dot(N, L1), 0.0);
  float d2 = max(dot(N, L2), 0.0);

  // solid, brand-coloured shading (the finale)
  vec3 shaded = uColor * (0.40 + 0.62 * d1 + 0.14 * d2);
  float spec = pow(max(dot(N, normalize(L1 + V)), 0.0), 20.0);
  shaded += vec3(1.0, 1.0, 0.95) * spec * 0.16;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  shaded += vec3(0.824, 0.925, 0.612) * fres * 0.22;

  // wireframe: contour grid in object space + silhouette
  vec2 g = vL.xy * 12.0 + vec2(0.37, 0.21);
  vec2 gd = abs(fract(g - 0.5) - 0.5) / max(fwidth(g), vec2(1e-4));
  float zc = vL.z * 12.0 + 0.43;
  float zd = abs(fract(zc - 0.5) - 0.5) / max(fwidth(zc), 1e-4);
  float grid = 1.0 - clamp(min(min(gd.x, gd.y), zd * 1.0), 0.0, 1.0);
  float edge = pow(1.0 - abs(dot(N, V)), 2.2);
  float back = gl_FrontFacing ? 1.0 : 0.45;
  float wa = clamp(max(grid * 0.85, edge * 0.95) * back, 0.0, 1.0);
  float fillA = 0.55 * back;
  vec3 ink = mix(vec3(0.824, 0.925, 0.612), uColor, 0.62); // wire: lime tinted towards the piece colour
  vec3 fillC = vec3(0.07 + 0.10 * d1);
  float aw = wa + fillA * (1.0 - wa);
  vec3 wcol = (ink * wa + fillC * fillA * (1.0 - wa)) / max(aw, 1e-4);

  float sy = clamp((vL.y + uCy) * 0.52 + 0.5, 0.0, 1.0);
  float m = clamp(uMix * 2.6 - sy * 1.6, 0.0, 1.0);
  m = m * m * m * (m * (m * 6.0 - 15.0) + 10.0);
  vec3 col = mix(wcol, shaded, m) + uColor * uFlash * 0.25 * (4.0 * m * (1.0 - m));
  float alpha = mix(aw, 1.0, m);
  // inner (back) faces melt away while the surface forms, so no polygons show through
  if (!gl_FrontFacing) alpha *= 1.0 - smoothstep(0.0, 0.6, m);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}`;
  const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const logo = new THREE.Group();
  scene.add(logo);
  const pieces = [];
  // where each piece starts (offset from its assembled spot) and how it is turned
  const SCATTER = {
    tl: { p: [-1.75, 0.55, 0.2], r: [1.5, -2.3, 0.9] },
    tr: { p: [1.7, 0.6, -0.8], r: [-1.9, 1.7, 2.4] },
    ml: { p: [-1.8, -0.3, -1.0], r: [2.3, 0.9, -1.7] },
    mr: { p: [1.7, 0.1, 0.8], r: [0.6, -2.7, 1.2] },
    bl: { p: [0.5, -0.6, 0.5], r: [-2.0, 2.2, -1.3] },
  };
  if (window.FIGMA_LOGO) {
    const dec = (s, T) => {
      const bin = atob(s);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return new T(u.buffer);
    };
    const Q = window.FIGMA_LOGO.q;
    window.FIGMA_LOGO.pieces.forEach((d) => {
      const pi = dec(d.p, Int16Array);
      const ni = dec(d.n, Int16Array);
      const pos = new Float32Array(pi.length);
      const nor = new Float32Array(ni.length);
      for (let i = 0; i < pi.length; i++) {
        pos[i] = pi[i] / Q;
        nor[i] = ni[i] / 32767;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      geo.setIndex(new THREE.BufferAttribute(dec(d.i, Uint16Array), 1));
      const uniforms = {
        uColor: { value: new THREE.Vector3(...hexRGB(({ tl: '#F0562B', tr: '#FB7C6B', ml: '#A369F8', mr: '#34BCF8', bl: '#38D286' })[d.id] || d.color)) },
        uMix: { value: 0 },
        uFlash: { value: 0 },
        uCy: { value: d.c[1] },
      };
      const mesh = new THREE.Mesh(
        geo,
        new THREE.ShaderMaterial({ vertexShader: LOGO_VERT, fragmentShader: LOGO_FRAG, uniforms, transparent: true, side: THREE.DoubleSide })
      );
      mesh.frustumCulled = false;
      logo.add(mesh);
      const sc = SCATTER[d.id];
      pieces.push({
        mesh,
        uniforms,
        c: new THREE.Vector3(...d.c),
        off: new THREE.Vector3(...sc.p),
        rot: new THREE.Vector3(...sc.r),
        fp: new THREE.Vector3(), fv: new THREE.Vector3(),
        fr: new THREE.Vector3(), fw: new THREE.Vector3(),
      });
    });
  }
  logo.visible = pieces.length > 0;

  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const easeOutBack = (x) => 1 + 2.05 * Math.pow(x - 1, 3) + 1.05 * Math.pow(x - 1, 2);
  const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
  const easeInCubic = (x) => x * x * x;
  const smooth = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  let assembled = 0;
  let lastT = 0, prevPx = 0, prevPy = 0, pvx = 0, pvy = 0;
  const tmpV = new THREE.Vector3();

  // hero = 0..1 while the hero is pinned (assembly), out = 0..1 while the hero scrolls away

  /* ---------- headline words: scattered, pointer-driven, assembling with the logo ---------- */
  const wordsBox = document.querySelector(".hero-words");
  const WORD_SCATTER = [
    { x: 0.13, y: 0.2, r: -0.26 },
    { x: 0.5, y: 0.1, r: 0.6 },
    { x: 0.84, y: 0.15, r: 0.2 },
    { x: 0.2, y: 0.86, r: 0.18 },
    { x: 0.88, y: 0.8, r: -0.3 },
  ];
  // every letter is its own little body: split each word into letter spans, scatter them over the whole screen
  const words = [];
  if (wordsBox) {
    let idx = 0;
    wordsBox.querySelectorAll(".hw").forEach((wEl) => {
      const txt = wEl.textContent;
      wEl.textContent = "";
      for (const ch of txt) {
        const el = document.createElement("span");
        el.className = "(*)".includes(ch) ? "hl hl--sans" + (ch === "*" ? " hl--star" : "") : "hl";
        el.textContent = ch;
        wEl.appendChild(el);
        const rnd = (n) => {
          const x = Math.sin((idx + 1) * 127.1 + n * 311.7) * 43758.5453;
          return x - Math.floor(x);
        };
        words.push({
          el, hx: 0, hy: 0, ox: 0, oy: 0,
          rot: (rnd(3) - 0.5) * 2.8, sx: 0.04 + rnd(1) * 0.92, sy: 0.08 + rnd(2) * 0.84,
          fx: 0, fy: 0, vx: 0, vy: 0, fr: 0, fw: 0, cx: 0, cy: 0,
        });
        idx++;
      }
    });
  }
  function measureWords() {
    if (!words.length) return;
    words.forEach((w) => (w.el.style.transform = "none"));
    words.forEach((w) => {
      const r = w.el.getBoundingClientRect();
      w.hx = r.left + r.width / 2;
      w.hy = r.top + r.height / 2;
      w.ox = w.sx * innerWidth - w.hx;
      w.oy = w.sy * innerHeight - w.hy;
    });
  }
  measureWords();
  addEventListener("resize", measureWords);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureWords);

  function stepWords(dt, pt, speed, aspect) {
    const W = innerWidth, H = innerHeight, K = 150;
    words.forEach((w) => {
      if (!REDUCED) {
        const dx = ((w.cx / W) * 2 - 1 - pt.x) * aspect;
        const dy = -((w.cy / H) * 2 - 1) - pt.y;
        const dist = Math.hypot(dx, dy);
        if (state.burst) {
          const bi = Math.pow(Math.max(0, 1 - dist / 1.3), 1.4);
          w.vx += (dx / (dist + 1e-3)) * 5.5 * bi * K;
          w.vy -= (dy / (dist + 1e-3)) * 5.5 * bi * K;
          w.fw += (Math.random() - 0.5) * 6 * bi;
        }
        const infl = Math.pow(Math.max(0, 1 - dist / 0.4), 2);
        if (infl > 0 && speed > 0.02) {
          const sp = Math.min(speed, 6);
          w.vx += (pvx / Math.max(speed, 1e-3)) * sp * 16 * infl * dt * K;
          w.vy -= (pvy / Math.max(speed, 1e-3)) * sp * 16 * infl * dt * K;
          w.vx += (dx / (dist + 1e-3)) * sp * 5 * infl * dt * K;
          w.vy -= (dy / (dist + 1e-3)) * sp * 5 * infl * dt * K;
          w.fw += -(dx * pvy - dy * pvx) * 6 * infl * dt;
        }
      }
      w.vx += -w.fx * 1.8 * dt; w.vy += -w.fy * 1.8 * dt;
      w.vx *= 1 - 0.9 * dt; w.vy *= 1 - 0.9 * dt;
      w.fx += w.vx * dt; w.fy += w.vy * dt;
      w.fw += -w.fr * 1.2 * dt; w.fw *= 1 - 0.6 * dt;
      w.fr += w.fw * dt;
      w.fr = Math.max(-0.7, Math.min(0.7, w.fr));
      // soft walls: the word's centre stays on screen
      const minX = W * 0.05, maxX = W * 0.95, minY = H * 0.07, maxY = H * 0.93;
      if (w.cx < minX) { w.fx += minX - w.cx; w.vx *= -0.65; }
      if (w.cx > maxX) { w.fx -= w.cx - maxX; w.vx *= -0.65; }
      if (w.cy < minY) { w.fy += minY - w.cy; w.vy *= -0.65; }
      if (w.cy > maxY) { w.fy -= w.cy - maxY; w.vy *= -0.65; }
    });
  }
  function applyWords(T, o) {
    if (!words.length) return;
    words.forEach((w, i) => {
      const a = clamp01((T - 0.04 - i * (0.38 / Math.max(1, words.length - 1))) / 0.55);
      const e = easeOutBack(a);
      const wf = 1 - smooth(0.0, 0.35, a);
      const x = w.ox * (1 - e) + w.fx * wf;
      const y = w.oy * (1 - e) + w.fy * wf;
      const rot = w.rot * (1 - easeOutCubic(a)) + w.fr * wf;
      w.cx = w.hx + x;
      w.cy = w.hy + y;
      // invisible by default, fades in while the word flies into the composition
      w.el.style.opacity = smooth(0.0, 0.4, a).toFixed(3);
      w.el.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0) rotate(" + rot.toFixed(4) + "rad)";
    });
    // the words leave together with the hero
    wordsBox.style.opacity = String(1 - smooth(0, 0.55, o));
    wordsBox.style.transform = "translate3d(0," + (-0.7 * o * innerHeight).toFixed(1) + "px,0)";
    wordsBox.style.visibility = o > 0.995 ? "hidden" : "visible";
  }

  function updateLogo(time) {
    if (!pieces.length) return;
    const h = state.hero;
    const o = state.out;
    const T = clamp01(h / 0.82);
    const aspect = innerWidth / innerHeight;
    // how far the visible area reaches in logo space, so pieces can live edge to edge
    const Sx = Math.min(1.85, aspect * 3.3);
    const halfW = (0.384 * 6.6 * aspect) / Sx;
    const halfH = (0.384 * 6.6) / Sx;
    const spreadX = THREE.MathUtils.clamp(halfW / 2.1, 0.3, 1.7);
    const settled = clamp01((h - 0.82) / 0.1);
    // ---- free-float physics: the scattered pieces get knocked around by the pointer, bounce off invisible walls
    const dt = Math.min(Math.max(time - lastT, 0), 0.05);
    lastT = time;
    const pt = state.pointerTarget || state.pointer;
    if (dt > 0) {
      pvx = (pt.x - prevPx) / dt;
      pvy = (pt.y - prevPy) / dt;
      prevPx = pt.x;
      prevPy = pt.y;
      const speed = Math.hypot(pvx, pvy);
      pieces.forEach((pc) => {
        if (!REDUCED) {
          tmpV.copy(pc.mesh.position);
          logo.localToWorld(tmpV);
          tmpV.project(camera);
          const dx = (tmpV.x - pt.x) * aspect;
          const dy = tmpV.y - pt.y;
          const dist = Math.hypot(dx, dy);
          const infl = Math.pow(Math.max(0, 1 - dist / 0.8), 2);
          if (state.burst) {
            const bi = Math.pow(Math.max(0, 1 - dist / 1.3), 1.4);
            pc.fv.x += (dx / (dist + 1e-3)) * 5.5 * bi;
            pc.fv.y += (dy / (dist + 1e-3)) * 5.5 * bi;
            pc.fw.x += (Math.random() - 0.5) * 9 * bi;
            pc.fw.y += (Math.random() - 0.5) * 9 * bi;
            pc.fw.z += (Math.random() - 0.5) * 12 * bi;
          }
          if (infl > 0 && speed > 0.02) {
            const sp = Math.min(speed, 6);
            pc.fv.x += (pvx / Math.max(speed, 1e-3)) * sp * 16 * infl * dt;
            pc.fv.y += (pvy / Math.max(speed, 1e-3)) * sp * 16 * infl * dt;
            pc.fv.x += (dx / (dist + 1e-3)) * sp * 5 * infl * dt;
            pc.fv.y += (dy / (dist + 1e-3)) * sp * 5 * infl * dt;
            pc.fw.z += -(dx * pvy - dy * pvx) * 30 * infl * dt;
            pc.fw.x += -pvy * 9 * infl * dt;
            pc.fw.y += pvx * 9 * infl * dt;
          }
        }
        // spring back home + damping (a little bouncy)
        pc.fv.addScaledVector(pc.fp, -1.8 * dt).multiplyScalar(1 - 0.9 * dt);
        pc.fw.addScaledVector(pc.fr, -1.2 * dt).multiplyScalar(1 - 0.6 * dt);
        pc.fp.addScaledVector(pc.fv, dt);
        pc.fr.addScaledVector(pc.fw, dt);
        // invisible walls
        const hx = pc.c.x + pc.off.x * spreadX, hy = pc.c.y + pc.off.y;
        const limX = halfW - 0.12, limY = halfH - 0.1;
        if (hx + pc.fp.x > limX) { pc.fp.x = limX - hx; pc.fv.x *= -0.65; }
        if (hx + pc.fp.x < -limX) { pc.fp.x = -limX - hx; pc.fv.x *= -0.65; }
        if (hy + pc.fp.y > limY) { pc.fp.y = limY - hy; pc.fv.y *= -0.65; }
        if (hy + pc.fp.y < -limY) { pc.fp.y = -limY - hy; pc.fv.y *= -0.65; }
        if (Math.abs(pc.fp.z) > 1.2) { pc.fp.z = Math.sign(pc.fp.z) * 1.2; pc.fv.z *= -0.6; }
      });
      stepWords(dt, pt, speed, aspect);
      state.burst = 0;
    }

    // colour arrives only at the very end, all pieces at once
    const solid = smooth(0.5, 1.0, h);
    const flash = Math.sin(Math.PI * clamp01((h - 0.6) / 0.39)) * 0.6;
    let done = 0;
    pieces.forEach((pc, k) => {
      const a = clamp01((T - k * 0.1) / 0.6);
      if (a >= 1) done++;
      const e = easeOutBack(a);
      const r = 1 - easeOutCubic(a);
      const w = 1 - a;
      const wf = 1 - smooth(0.0, 0.35, a); // physics offset fades out as the piece flies home
      pc.mesh.position.set(
        pc.c.x + pc.off.x * spreadX * (1 - e) + pc.fp.x * wf,
        pc.c.y + pc.off.y * (1 - e) + pc.fp.y * wf,
        pc.c.z + pc.off.z * (1 - e) + pc.fp.z * wf
      );
      pc.mesh.rotation.set(
        pc.rot.x * r + pc.fr.x * wf + Math.sin(time * 0.4 + k * 1.7) * 0.35 * w,
        pc.rot.y * r + pc.fr.y * wf + Math.sin(time * 0.33 + k * 2.3) * 0.35 * w,
        pc.rot.z * r + pc.fr.z * wf + Math.sin(time * 0.27 + k * 0.9) * 0.35 * w
      );
      // on exit the pieces fly apart along their own scatter direction (the logo's own turn on scroll stays)
      if (o > 0) {
        const L = Math.hypot(pc.off.x, pc.off.y, pc.off.z) || 1;
        const fly = Math.pow(o, 1.6) * 5.5 * (1 + k * 0.18);
        pc.mesh.position.x += (pc.off.x / L) * fly;
        pc.mesh.position.y += (pc.off.y / L) * fly;
        pc.mesh.position.z += (pc.off.z / L) * fly * 0.6;
      }
      pc.uniforms.uMix.value = solid;
      pc.uniforms.uFlash.value = flash;
      pc.mesh.material.depthWrite = solid > 0.97;
    });
    assembled = done;
    applyWords(T, o);
    // chromatic aberration follows how much is moving: pointer knocks, scrolling, the colour flash at the end
    {
      let e = 0;
      e += Math.abs(state.velocity || 0) * 0.9 + flash * 0.9;
      abE += (Math.min(e * 0.4, 1) - abE) * 0.14;
      const vis = 1 - smooth(0, 0.5, o);
      postMat.uniforms.uAb.value = abE * 0.003 * vis;
      postMat.uniforms.uDir.value.set(0, 0);
      if (wordsBox) {
        wordsBox.style.setProperty("--ab", (abE * 0.8 * vis).toFixed(2));
        wordsBox.classList.toggle("is-ab", abE * vis > 0.1);
      }
    }
    if (hintEl) hintEl.style.opacity = String(1 - smooth(0, 0.07, T));

    const S = Math.min(1.85, aspect * 3.3);
    logo.scale.setScalar(Math.max(S * (1 - 0.3 * easeInCubic(o)), 0.0001));
    logo.visible = o < 0.995;
    logo.position.set(0.4, 0.17 + Math.sin(time * 0.7) * 0.05 * settled, 0);
    logo.rotation.set(
      -state.pointer.y * 0.16,
      Math.atan2(camPos.x, camPos.z) * 0.8 + state.pointer.x * 0.28 + Math.sin(time * 0.5) * 0.07 * settled + o * Math.PI * 0.9,
      0
    );

    // the displaced blob takes over once the logo leaves
    const blobS = smooth(0, 1, o);
    body.scale.setScalar(Math.max(blobS, 0.0001));
    shell.scale.copy(body.scale);
    body.visible = shell.visible = false; // blob removed
  }

  /* ---------- light liquid hero background (drawn in WebGL, wiped away together with the hero) ---------- */
  const BG_FRAG = `
uniform float uTime;
uniform float uAspect;
uniform float uEdge;
uniform vec2 uPointer;
varying vec2 vUv;
${SNOISE}
void main(){
  if ((1.0 - vUv.y) > uEdge) discard;
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec2 pm = uPointer * vec2(uAspect, 1.0) * 0.5;
  float v = smoothstep(0.15, 1.1, length(p));
  float g = smoothstep(0.6, 0.0, length(p - pm)) * 0.012;
  vec3 col = vec3(0.071);
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;
  const bgMat = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: BG_FRAG,
    uniforms: { uTime: { value: 0 }, uAspect: { value: 1 }, uEdge: { value: 1 }, uPointer: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
  bg.frustumCulled = false;
  bg.renderOrder = -10;
  scene.add(bg);
  const heroEl = document.getElementById("hero");
  // the light area ends exactly where the hero block ends, so it scrolls away with it
  function updateBg(time) {
    const hr = heroEl.getBoundingClientRect();
    const extra = Math.max(0, innerHeight - heroEl.offsetHeight);
    const bottom = hr.bottom + extra * clamp01(hr.bottom / Math.max(heroEl.offsetHeight, 1));
    const edge = clamp01(bottom / innerHeight);
    bg.visible = edge > 0.002;
    bgMat.uniforms.uTime.value = time + 20.0;
    bgMat.uniforms.uAspect.value = innerWidth / innerHeight;
    bgMat.uniforms.uEdge.value = edge;
    bgMat.uniforms.uPointer.value.copy(state.pointer);
  }

  // camera + look-at paths
  const camPath = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0, 0.15, 6.6),
      new THREE.Vector3(3.4, 0.8, 5.6),
      new THREE.Vector3(1.8, -0.6, 4.6),
      new THREE.Vector3(-3.6, 1.1, 5.4),
      new THREE.Vector3(-0.6, 2.3, 8.2),
    ],
    false,
    "catmullrom",
    0.35
  );
  const lookPath = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.4, 0.1, 0),
      new THREE.Vector3(0, -0.2, 0),
      new THREE.Vector3(-0.4, 0.3, 0),
      new THREE.Vector3(0, 0, 0),
    ],
    false,
    "catmullrom",
    0.35
  );

  const state = {
    progress: 0,
    velocity: 0,
    hero: 0,
    out: 0,
    pointer: new THREE.Vector2(0, 0),
    pointerTarget: new THREE.Vector2(0, 0),
  };
  const camPos = new THREE.Vector3();
  const lookPos = new THREE.Vector3();
  const offset = new THREE.Vector3();
  let time = 0;

  function render(dt) {
    time += dt;
    bodyUniforms.uTime.value = time;

    const ampTarget = 0.34 + Math.min(Math.abs(state.velocity) * 0.35, 0.3);
    bodyUniforms.uAmp.value += (ampTarget - bodyUniforms.uAmp.value) * 0.08;

    const p = THREE.MathUtils.clamp(state.progress, 0, 1);
    camPath.getPoint(p, camPos);
    lookPath.getPoint(p, lookPos);
    state.pointer.lerp(state.pointerTarget, 0.045);
    offset.set(state.pointer.x * 0.55, state.pointer.y * 0.35, 0);
    camPos.add(offset);
    lookPos.addScaledVector(offset, 0.35);
    camera.position.copy(camPos);
    camera.lookAt(lookPos);

    body.rotation.y = time * 0.12 + p * Math.PI * 1.6;
    body.rotation.x = Math.sin(time * 0.1) * 0.15 + p * 0.7;
    shell.rotation.copy(body.rotation);
    shell.rotation.z = -time * 0.05;

    updateLogo(time);
    updateBg(time);

    renderPost();
  }

  addEventListener(
    "pointermove",
    (e) => {
      state.pointerTarget.set(
        (e.clientX / innerWidth - 0.5) * 2,
        -(e.clientY / innerHeight - 0.5) * 2
      );
    },
    { passive: true }
  );
  addEventListener(
    "pointerdown",
    (e) => {
      state.pointerTarget.set((e.clientX / innerWidth - 0.5) * 2, -(e.clientY / innerHeight - 0.5) * 2);
      state.burst = 1;
    },
    { passive: true }
  );
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    rt.setSize(Math.round(innerWidth * pixelRatio), Math.round(innerHeight * pixelRatio));
  });

  return {
    render,
    setProgress: (v) => (state.progress = v),
    setHero: (v) => (state.hero = v),
    setOut: (v) => (state.out = v),
    getAssembled: () => assembled,
    setVelocity: (v) => (state.velocity = v),
    seek: (v) => (time = v),
    renderer,
  };
}

/* ---------- init scene (with fallback) ---------- */
let scene3d = null;
try {
  const probe = document.createElement("canvas");
  if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) {
    throw new Error("WebGL unavailable");
  }
  scene3d = createScene();
  gsap.ticker.add((_t, dt) => {
    scene3d.render(Math.min(dt / 1000, 0.05));
  });
} catch (e) {
  document.body.classList.add("no-webgl");
}

/* ---------- smooth scroll ---------- */
const lenis = new Lenis({ lerp: REDUCED ? 1 : 0.09, wheelMultiplier: 1 });
lenis.stop();
lenis.on("scroll", ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);

ScrollTrigger.create({
  start: 0,
  end: () => ScrollTrigger.maxScroll(window),
  onUpdate: (self) => {
    if (scene3d) {
      scene3d.setProgress(self.progress);
      scene3d.setVelocity(self.getVelocity() / 2500);
    }
  },
});

/* ---------- hero: pinned, the Figma logo assembles itself on scroll ---------- */
const scrollLabel = document.querySelector(".hero__scroll span:first-child");
if (scene3d) {
  if (REDUCED) {
    scene3d.setHero(1);
  } else {
    ScrollTrigger.create({
      trigger: "#hero",
      start: "top top",
      end: () => "+=" + Math.round(innerHeight * 1.6),
      pin: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => scene3d.setHero(self.progress),
      onRefresh: (self) => scene3d.setHero(self.progress),
      onLeave: () => scene3d.setHero(1),
      onLeaveBack: () => scene3d.setHero(0),
    });
  }
  // the logo hands the stage back to the blob when the hero scrolls away (also with reduced motion)
  ScrollTrigger.create({
    trigger: "#manifesto",
    start: "top bottom",
    end: "top 30%",
    onUpdate: (self) => scene3d.setOut(self.progress),
    onRefresh: (self) => scene3d.setOut(self.progress),
    onLeave: () => scene3d.setOut(1),
    onLeaveBack: () => scene3d.setOut(0),
  });
  let lastCount = -1;
  gsap.ticker.add(() => {
    const n = scene3d.getAssembled();
    if (n === lastCount || !scrollLabel) return;
    lastCount = n;
    scrollLabel.textContent = n === 0 ? "СКРОЛЛ" : n >= 5 ? "СОБРАНО" : "СБОРКА " + n + "/5";
  });
}

/* ---------- MSK clock ---------- */
const clockEl = document.getElementById("clock");
function tickClock() {
  clockEl.textContent = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date());
}
tickClock();
setInterval(tickClock, 20000);

/* ---------- manifesto word split + highlights ---------- */
const HIGHLIGHTS = ["AI", "Human-in-the-loop", "архитектуру,", "пайплайны,"];
const wordsEl = document.querySelector(".js-words");
if (wordsEl) {
  const words = wordsEl.textContent.trim().split(/ +/);
  wordsEl.innerHTML = words
    .map((w) => `<span class="w${HIGHLIGHTS.includes(w) ? " w--hl" : ""}">${w}</span>`)
    .join(" ");
}

/* ---------- start (preloader removed) ---------- */
// Hero text is hidden for now via .hero--textless (see style.css); header shown immediately.
document.documentElement.classList.remove("lenis-stopped");
lenis.start();
gsap.set(".header", { opacity: 1 });
requestAnimationFrame(() => ScrollTrigger.refresh());

/* ---------- section title line reveals ---------- */
gsap.utils.toArray(".exp__company .rl__in, .pipe__title .rl__in, .contact__cta .rl__in").forEach((el) => {
  gsap.to(el, {
    y: 0,
    duration: 1.2,
    ease: "power3.out",
    scrollTrigger: { trigger: el.closest("section, footer"), start: "top 72%" },
  });
});

/* ---------- section labels ---------- */
gsap.utils.toArray(".sec-label").forEach((el) => {
  gsap.from(el, {
    autoAlpha: 0,
    x: -24,
    duration: 0.8,
    ease: "power3.out",
    scrollTrigger: { trigger: el, start: "top 88%" },
  });
});

/* ---------- manifesto word scrub ---------- */
if (wordsEl) {
  gsap.fromTo(
    wordsEl.querySelectorAll(".w"),
    { opacity: 0.12 },
    {
      opacity: 1,
      stagger: 0.06,
      ease: "none",
      scrollTrigger: { trigger: wordsEl, start: "top 78%", end: "bottom 45%", scrub: true },
    }
  );
}

/* ---------- manifesto paragraph 2: same word-by-word reveal ---------- */
{
  const p2 = document.querySelector(".mf-blk--2 .mf-t");
  if (p2) {
    const frag = document.createDocumentFragment();
    [...p2.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        n.textContent.split(/( +)/).forEach((tok) => {
          if (!tok) return;
          if (/^ +$/.test(tok)) { frag.appendChild(document.createTextNode(" ")); return; }
          const sp = document.createElement("span"); sp.className = "w"; sp.textContent = tok; frag.appendChild(sp);
        });
      } else { n.classList.add("w"); frag.appendChild(n); }
    });
    p2.textContent = ""; p2.appendChild(frag);
    gsap.fromTo(p2.querySelectorAll(".w"), { opacity: 0.12 }, {
      opacity: 1, stagger: 0.06, ease: "none",
      scrollTrigger: { trigger: p2, start: "top 78%", end: "bottom 45%", scrub: true },
    });
  }
}

/* ---------- numbers ---------- */
gsap.utils.toArray(".num-row").forEach((row) => {
  const val = row.querySelector(".num-row__val");
  const target = parseInt(val.dataset.count, 10);
  const prefix = val.dataset.prefix || "";
  const suffix = val.dataset.suffix || "";
  const obj = { v: 0 };
  gsap.from(row, {
    autoAlpha: 0,
    y: 40,
    duration: 0.8,
    ease: "power3.out",
    scrollTrigger: { trigger: row, start: "top 85%" },
  });
  gsap.to(obj, {
    v: target,
    duration: 1.2,
    ease: "power3.out",
    onUpdate: () => {
      val.innerHTML = (prefix ? `<span class="u u--pre">${prefix}</span>` : "") + Math.round(obj.v) + (suffix ? `<span class="u u--suf">${suffix}</span>` : "");
    },
    scrollTrigger: { trigger: row, start: "top 85%" },
  });
});

/* ---------- experience ---------- */
gsap.utils.toArray(".exp-item").forEach((el) => {
  gsap.from(el, {
    autoAlpha: 0,
    y: 44,
    duration: 0.8,
    ease: "power3.out",
    scrollTrigger: { trigger: el, start: "top 88%" },
  });
});
gsap.utils.toArray(".exp__facts span").forEach((el, i) => {
  gsap.from(el, {
    autoAlpha: 0,
    x: -18,
    duration: 0.8,
    delay: i * 0.08,
    ease: "power3.out",
    scrollTrigger: { trigger: ".exp__facts", start: "top 85%" },
  });
});

/* ---------- pipeline ---------- */
gsap.utils.toArray("#pipeFlow > *").forEach((el, i) => {
  gsap.from(el, {
    autoAlpha: 0,
    y: 34,
    scale: 0.96,
    duration: 0.8,
    ease: "power3.out",
    scrollTrigger: { trigger: "#pipeFlow", start: "top 80%" },
    delay: i * 0.1,
  });
});
gsap.from(".pipe__result", {
  autoAlpha: 0,
  y: 30,
  duration: 0.8,
  ease: "power3.out",
  scrollTrigger: { trigger: ".pipe__result", start: "top 88%" },
});

/* ---------- reverse ---------- */
gsap.from(".rev__grid i", {
  scaleY: 0,
  transformOrigin: "top",
  duration: 0.8,
  ease: "power3.out",
  stagger: 0.04,
  scrollTrigger: { trigger: ".rev", start: "top 70%" },
});
gsap.from(".rev__grid b", {
  autoAlpha: 0,
  duration: 0.4,
  delay: 0.6,
  ease: "power3.out",
  scrollTrigger: { trigger: ".rev", start: "top 70%" },
});
gsap.from(".rev__line, .rev__txt, .rev__cta", {
  autoAlpha: 0,
  y: 32,
  duration: 0.8,
  ease: "power3.out",
  stagger: 0.12,
  scrollTrigger: { trigger: ".rev__title", start: "top 80%" },
});

/* ---------- stack ---------- */
gsap.utils.toArray(".stack-col").forEach((el, i) => {
  gsap.from(el, {
    autoAlpha: 0,
    y: 40,
    duration: 0.8,
    delay: i * 0.08,
    ease: "power3.out",
    scrollTrigger: { trigger: ".stack__grid", start: "top 82%" },
  });
});

/* ---------- awards ---------- */
gsap.utils.toArray(".award-row").forEach((row) => {
  const b = row.querySelector("b[data-count]");
  const target = parseInt(b.dataset.count, 10);
  const obj = { v: 0 };
  gsap.from(row, {
    autoAlpha: 0,
    x: -32,
    duration: 0.8,
    ease: "power3.out",
    scrollTrigger: { trigger: row, start: "top 88%" },
  });
  gsap.to(obj, {
    v: target,
    duration: 1.2,
    ease: "power3.out",
    onUpdate: () => {
      b.textContent = String(Math.round(obj.v)).padStart(2, "0");
    },
    scrollTrigger: { trigger: row, start: "top 88%" },
  });
});

/* ---------- education ---------- */
gsap.utils.toArray(".edu-row").forEach((el) => {
  gsap.from(el, {
    autoAlpha: 0,
    y: 30,
    duration: 0.8,
    ease: "power3.out",
    scrollTrigger: { trigger: el, start: "top 90%" },
  });
});

/* ---------- contact links ---------- */
gsap.utils.toArray(".contact-link").forEach((el) => {
  gsap.from(el, {
    autoAlpha: 0,
    y: 24,
    duration: 0.8,
    ease: "power3.out",
    scrollTrigger: { trigger: el, start: "top 92%" },
  });
});

/* ---------- warp wheel of lines (second screen) ---------- */
(() => {
  const sec = document.getElementById("warp");
  const cv = document.getElementById("warpCv");
  if (!sec || !cv || !window.THREE) return;
  const LINES = ["ДИЗАЙН-СИСТЕМЫ", "AI-АВТОМАТИЗАЦИЯ", "3D В ВЕБЕ", "ПРОТОТИПЫ", "HUMAN-IN-THE-LOOP"];
  const N = LINES.length;
  const LH = 192, TW = 3072;
  const tc = document.createElement("canvas");
  tc.width = TW; tc.height = LH * N;
  const g = tc.getContext("2d");
  g.fillStyle = "#fff";
  g.textAlign = "center"; g.textBaseline = "middle";
  const fam = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';
  let fs = LH * 0.9;
  g.font = "600 " + fs + "px " + fam;
  try { g.letterSpacing = (-0.04 * fs) + "px"; } catch (e) {}
  const widest = Math.max(...LINES.map((t) => g.measureText(t).width));
  if (widest > TW * 0.86) {
    fs *= (TW * 0.86) / widest;
    g.font = "600 " + fs + "px " + fam;
    try { g.letterSpacing = (-0.04 * fs) + "px"; } catch (e) {}
  }
  LINES.forEach((t, i) => g.fillText(t, TW / 2, LH * (i + 0.5) + LH * 0.04));
  const tex = new THREE.CanvasTexture(tc);
  tex.wrapT = THREE.RepeatWrapping; tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.anisotropy = 4;

  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { tx: { value: tex }, uOff: { value: 0 }, uShear: { value: 0 }, uAsp: { value: 1.78 }, uN: { value: N } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `uniform sampler2D tx; uniform float uOff, uShear, uAsp, uN; varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * vec2(uAsp, 1.0);
  float r2 = dot(p, p);
  vec2 s = p * (1.0 - 0.4 * r2);
  float L = 0.125;
  s.x += s.y * uShear;
  float yl = s.y / L;
  float u = s.x / (L * ${(TW / LH).toFixed(1)}) + 0.5;
  float v = fract(0.5 + (yl - uOff) / uN);
  float a = texture2D(tx, vec2(u, v)).a;
  float fo = 1.0 - smoothstep(0.0, 3.3, abs(yl));
  float k = a * mix(0.15, 1.0, fo) * (1.0 - 0.4 * smoothstep(0.45, 1.0, length(p)));
  vec3 bg = vec3(0.071);
  vec3 ink = mix(vec3(0.42, 0.44, 0.40), vec3(0.824, 0.925, 0.612), fo);
  gl_FragColor = vec4(mix(bg, ink, k), 1.0);
}`,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);

  function size() {
    const w = sec.clientWidth, h = sec.clientHeight;
    renderer.setSize(w, h, false);
    mat.uniforms.uAsp.value = w / h;
  }
  size();
  addEventListener("resize", size);

  let vis = false, off = 0, shear = 0, last = 0;
  new IntersectionObserver((e) => { vis = e[0].isIntersecting; }, { rootMargin: "20% 0px" }).observe(sec);
  const draw = () => {
    if (!vis) return;
    const top = sec.getBoundingClientRect().top + scrollY;
    const target = REDUCED ? 0 : (scrollY - top) / (innerHeight * 0.16);
    const prev = off;
    off += (target - off) * (REDUCED ? 1 : 0.12);
    const v = off - prev;
    shear += (gsap.utils.clamp(-0.35, 0.35, v * 0.9) - shear) * 0.12;
    mat.uniforms.uOff.value = off;
    mat.uniforms.uShear.value = shear;
    renderer.render(scene, cam);
  };
  gsap.ticker.add(draw);
})();

/* ---------- custom cursor ---------- */
if (COARSE) {
  document.getElementById("cursorDot").remove();
  document.getElementById("cursorRing").remove();
} else {
  const dot = document.getElementById("cursorDot");
  const ring = document.getElementById("cursorRing");
  const dotX = gsap.quickTo(dot, "x", { duration: 0.2, ease: "power3.out" });
  const dotY = gsap.quickTo(dot, "y", { duration: 0.2, ease: "power3.out" });
  const ringX = gsap.quickTo(ring, "x", { duration: 0.4, ease: "power3.out" });
  const ringY = gsap.quickTo(ring, "y", { duration: 0.4, ease: "power3.out" });
  addEventListener(
    "pointermove",
    (e) => {
      dotX(e.clientX);
      dotY(e.clientY);
      ringX(e.clientX);
      ringY(e.clientY);
    },
    { passive: true }
  );
  document.querySelectorAll('[data-cursor="extend"]').forEach((el) => {
    el.addEventListener("pointerenter", () => ring.classList.add("is-extend"));
    el.addEventListener("pointerleave", () => ring.classList.remove("is-extend"));
  });
}

/* ---------- magnetic CTA ---------- */
if (!COARSE) {
  document.querySelectorAll(".js-magnet").forEach((el) => {
    const strength = 0.25;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      gsap.to(el, { x: dx * strength, y: dy * strength, duration: 0.4, ease: "power3.out" });
    });
    el.addEventListener("pointerleave", () => {
      gsap.to(el, { x: 0, y: 0, duration: 0.8, ease: "power3.out" });
    });
  });
}

/* ---------- smooth anchor navigation ---------- */
document.querySelectorAll(".js-scroll").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.querySelector(link.dataset.target);
    if (target) lenis.scrollTo(target, { offset: 0, duration: REDUCED ? 0 : 1.4 });
  });
});

/* ---------- readiness hooks ---------- */
let sceneReady = true;
gsap.ticker.add(() => {
  if (sceneReady) {
    sceneReady = false;
    window.__SCENE_READY__ = true;
  }
});
window.__seek = (v) => scene3d && scene3d.seek(v);
const seekParam = new URLSearchParams(location.search).get("t");
if (seekParam && scene3d) scene3d.seek(parseFloat(seekParam));
document.fonts?.ready?.then(() => ScrollTrigger.refresh());

/* ---------- press H: show the 12-column layout grid with numbered columns ---------- */
addEventListener("keydown", (e) => {
  if ((e.key === "h" || e.key === "H" || e.key === "р" || e.key === "Р") && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    document.documentElement.classList.toggle("show-grid");
  }
});

/* ---------- stack rows: remember which side the pointer entered / left by (drives the bar's transform-origin) ---------- */
document.querySelectorAll(".stack-col__list li").forEach((li) => {
  // two copies of the text, rolled like the top menu: sans -> italic serif
  const label = li.textContent;
  li.innerHTML = '<span class="sl"><span class="sl__w"><span class="sl__a"></span><span class="sl__b"></span></span></span>';
  li.querySelector(".sl__a").textContent = label;
  li.querySelector(".sl__b").textContent = label;
  const side = (e) => {
    const r = li.getBoundingClientRect();
    li.dataset.s = e.clientY < r.top + r.height / 2 ? "t" : "b";
  };
  li.addEventListener("pointerenter", side);
  li.addEventListener("pointerleave", side);
});


/* ---------- awards: name rolls to italic serif on hover (same as the stack rows) ---------- */
document.querySelectorAll(".award-row__name").forEach((el) => {
  const label = el.textContent.trim();
  el.setAttribute("aria-label", label);
  el.innerHTML = '<span class="sl" aria-hidden="true"><span class="sl__w"><span class="sl__a"></span><span class="sl__b"></span></span></span>';
  el.querySelector(".sl__a").textContent = label;
  el.querySelector(".sl__b").textContent = label;
});

/* ---------- awards: the real 3D models as wireframe; on hover they fall apart into triangles and the next one assembles ---------- */
const initAwards = () => {
  const M = window.AWARD_MODELS;
  const cv = document.getElementById("awCv");
  const rows = [...document.querySelectorAll(".award-row")];
  const list = document.querySelector(".awards__list");
  if (!M || !cv || !list || COARSE || REDUCED || !window.THREE) return;
  const KEYS = ["cssda", "gold", "rr", "aww", "tag"];
  const LETTERS = {"W": [[0.4262, -0.5], [0.1778, -0.5], [0.0422, 0.0784], [0.0303, 0.1301], [0.0193, 0.1829], [0.0094, 0.2369], [0.0004, 0.2921], [-0.0078, 0.2483], [-0.0151, 0.2102], [-0.0216, 0.1775], [-0.0273, 0.1505], [-0.0408, 0.0916], [-0.0704, -0.0365], [-0.1164, -0.2337], [-0.1785, -0.5], [-0.4269, -0.5], [-0.6845, 0.5], [-0.4723, 0.5], [-0.3275, -0.1458], [-0.2949, -0.302], [-0.285, -0.2532], [-0.2753, -0.2056], [-0.2657, -0.159], [-0.2562, -0.1136], [-0.2403, -0.0415], [-0.2114, 0.0847], [-0.1695, 0.2652], [-0.1146, 0.5], [0.1196, 0.5], [0.2459, -0.0323], [0.2547, -0.0715], [0.266, -0.1295], [0.2799, -0.2064], [0.2963, -0.302], [0.3141, -0.2197], [0.3517, -0.0564], [0.4723, 0.5], [0.6845, 0.5]], "T": [[0.1043, 0.3382], [0.1043, -0.5], [-0.105, -0.5], [-0.105, 0.3382], [-0.428, 0.3382], [-0.428, 0.5], [0.428, 0.5], [0.428, 0.3382]]};
  const LET = {};
  const letterGeo = (ch) => {
    const sh = new THREE.Shape(LETTERS[ch].map((p) => new THREE.Vector2(p[0] * 1.05, p[1] * 1.05)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 1 });
    g.translate(0, 0, -0.15);
    let out = g.index ? g.toNonIndexed() : g;
    if (ch === "W") {
      const d = new THREE.SphereGeometry(0.13, 24, 16).toNonIndexed();
      d.translate(0.99, -0.525 + 0.13, 0);
      const mg = (n) => { const A = out.attributes[n].array, B = d.attributes[n].array, C = new Float32Array(A.length + B.length); C.set(A); C.set(B, A.length); return C; };
      const m = new THREE.BufferGeometry();
      m.setAttribute("position", new THREE.BufferAttribute(mg("position"), 3));
      m.setAttribute("normal", new THREE.BufferAttribute(mg("normal"), 3));
      m.translate(-0.13, 0, 0);
      out = m;
    }
    return out;
  };
  const b64 = (s, T) => {
    const bin = atob(s), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new T(u.buffer);
  };
  const CW = 200, CH = 200;
  const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(CW, CH, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, CW / CH, 0.1, 20);
  cam.position.set(0, 0, 3.4);
  const group = new THREE.Group();
  group.scale.setScalar(0.86);
  scene.add(group);

  const VERT = `
attribute vec3 aC; attribute vec3 aDir; attribute vec4 aR;
uniform float uAsm;
varying vec3 vN; varying vec3 vP; varying vec3 vL; varying float vE;
mat3 rot(vec3 a, float g){ float s = sin(g), c = cos(g), o = 1.0 - c;
  return mat3(o*a.x*a.x+c, o*a.x*a.y+a.z*s, o*a.z*a.x-a.y*s, o*a.x*a.y-a.z*s, o*a.y*a.y+c, o*a.y*a.z+a.x*s, o*a.z*a.x+a.y*s, o*a.y*a.z-a.x*s, o*a.z*a.z+c); }
void main(){
  float t = clamp((uAsm - aR.x * 0.5) / 0.5, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - t, 3.0);
  float d = 1.0 - e;
  mat3 R = rot(aDir, aR.y * 7.0 * d);
  vec3 p = aC + aDir * (0.5 + aR.z * 1.1) * d + R * (position - aC);
  vL = position; vN = normalMatrix * (R * normal); vE = e;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
  const FRAG = `
varying vec3 vN; varying vec3 vP; varying vec3 vL; varying float vE;
void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vP);
  float d1 = max(dot(N, normalize(vec3(-0.45, 0.8, 0.9))), 0.0);
  float F = 14.0;
  vec2 g = vL.xy * F + vec2(0.37, 0.21);
  vec2 gd = abs(fract(g - 0.5) - 0.5) / max(fwidth(g), vec2(1e-4));
  float zc = vL.z * F + 0.43;
  float zd = abs(fract(zc - 0.5) - 0.5) / max(fwidth(zc), 1e-4);
  float grid = 1.0 - clamp(min(min(gd.x, gd.y), zd), 0.0, 1.0);
  float edge = pow(1.0 - abs(dot(N, V)), 2.2);
  float back = gl_FrontFacing ? 1.0 : 0.35;
  float wa = clamp(max(grid * 0.9, edge * 1.0) * back, 0.0, 1.0);
  float fillA = 0.92 * back;
  vec3 ink = vec3(0.055);
  vec3 fillC = vec3(0.824, 0.925, 0.612) + 0.0 * d1;
  float aw = wa + fillA * (1.0 - wa);
  vec3 col = vec3(0.824, 0.925, 0.612) * clamp(0.78 + 0.35 * d1 + 0.2 * edge, 0.0, 1.05);
  float alpha = smoothstep(0.0, 0.3, vE);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}`;

  let sd = 4242;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const models = KEYS.map((k) => {
    let geo;
    if (LET[k]) geo = letterGeo(LET[k]);
    else {
      const src = M[k], q = M.q;
      const p16 = b64(src.p, Int16Array), n16 = b64(src.n, Int16Array), idx = b64(src.i, Uint16Array);
      const pos = new Float32Array(p16.length), nor = new Float32Array(n16.length);
      for (let i = 0; i < p16.length; i++) pos[i] = p16[i] / q;
      for (let i = 0; i < n16.length; i++) nor[i] = n16[i] / 32767;
      geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo = geo.toNonIndexed();
    }
    const P = geo.attributes.position.array, V = P.length / 3, T = V / 3;
    const aC = new Float32Array(V * 3), aDir = new Float32Array(V * 3), aR = new Float32Array(V * 4);
    for (let t = 0; t < T; t++) {
      const o = t * 9;
      const cx = (P[o] + P[o + 3] + P[o + 6]) / 3, cy = (P[o + 1] + P[o + 4] + P[o + 7]) / 3, cz = (P[o + 2] + P[o + 5] + P[o + 8]) / 3;
      let dx = rnd() - 0.5, dy = rnd() - 0.5, dz = rnd() - 0.5;
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      const r0 = rnd(), r1 = rnd(), r2 = rnd(), r3 = rnd();
      for (let v = 0; v < 3; v++) {
        const i3 = (t * 3 + v) * 3, i4 = (t * 3 + v) * 4;
        aC[i3] = cx; aC[i3 + 1] = cy; aC[i3 + 2] = cz;
        aDir[i3] = dx; aDir[i3 + 1] = dy; aDir[i3 + 2] = dz;
        aR[i4] = r0; aR[i4 + 1] = r1 * 2 - 1; aR[i4 + 2] = r2; aR[i4 + 3] = r3;
      }
    }
    geo.setAttribute("aC", new THREE.BufferAttribute(aC, 3));
    geo.setAttribute("aDir", new THREE.BufferAttribute(aDir, 3));
    geo.setAttribute("aR", new THREE.BufferAttribute(aR, 4));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAsm: { value: 0 } }, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, side: THREE.DoubleSide, depthWrite: false, depthTest: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
    geo.computeBoundingBox();
    const bs = geo.boundingBox.getSize(new THREE.Vector3());
    return { mesh, u: mat.uniforms, fit: 1.05 / Math.max(bs.x, bs.y, bs.z, 1e-4) };
  });

  const sc = { s: 0 };
  let active = -1, curRow = null;
  models.forEach((m) => { m.u.uAsm.value = 1; m.mesh.visible = false; });
  const show = (k, row) => {
    curRow = row;
    if (active === k) { gsap.to(sc, { s: 1, duration: 0.2, ease: "power3.out", overwrite: true }); return; }
    active = k;
    models.forEach((m, i) => (m.mesh.visible = i === k));
    sc.s = 0;
    gsap.to(sc, { s: 1, duration: 0.2, ease: "power3.out", overwrite: true });
  };
  const hide = () => gsap.to(sc, { s: 0, duration: 0.2, ease: "power3.out", overwrite: true, onComplete: () => { active = -1; models.forEach((m) => (m.mesh.visible = false)); } });
  const AW_K = 0.47;
  const SHIFT = 128;
  const textRect = (row) => row.querySelector(".award-row__name .sl").getBoundingClientRect();
  const endOf = (row) => {
    const nm = row.querySelector(".award-row__name"); const r = document.createRange(); r.selectNodeContents(nm);
    return r.getBoundingClientRect().right;
  };
  rows.forEach((row) => {
    const k = KEYS.indexOf(row.dataset.model || "");
    row.addEventListener("pointerenter", () => { if (k < 0) { curRow = null; return hide(); } show(k, row); });
  });
  list.addEventListener("pointerleave", () => { curRow = null; hide(); });
  const tilt = { x: 0, y: 0 };
  const tx = gsap.quickTo(tilt, "y", { duration: 0.8, ease: "power3.out" });
  const ty = gsap.quickTo(tilt, "x", { duration: 0.8, ease: "power3.out" });
  addEventListener("pointermove", (e) => {
    tx((e.clientX / innerWidth - 0.5) * 1.1);
    ty(-(e.clientY / innerHeight - 0.5) * 0.6);
  }, { passive: true });
  gsap.set(cv, { y: -9999 });
  let clock = 0;
  gsap.ticker.add((_t, dt) => {
    if (sc.s < 0.002 || active < 0) { if (cv.style.visibility !== "hidden") cv.style.visibility = "hidden"; return; }
    if (curRow) {
      const nr = textRect(curRow);
      gsap.set(cv, { x: curRow.getBoundingClientRect().left + SHIFT / 2 - 6 - CW / 2, y: nr.top + nr.height * AW_K - CH / 2 });
    }
    cv.style.visibility = "visible";
    clock += dt / 1000;
    group.scale.setScalar(0.86 * models[active].fit * Math.max(sc.s, 0.0001));
    group.rotation.y = clock * 1.3;
    group.rotation.x = 0.18;
    renderer.render(scene, cam);
  });
};

/* awards models (~0.5 MB) load only when the section is about to appear */
(() => {
  const sec = document.getElementById("awards");
  if (!sec) return;
  let started = false;
  const go = () => {
    if (started) return;
    started = true;
    const sc = document.createElement("script");
    sc.src = "awards-models.js";
    sc.onload = initAwards;
    document.body.appendChild(sc);
  };
  if (!("IntersectionObserver" in window)) return go();
  const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: "1500px 0px" });
  io.observe(sec);
})();


/* ---------- contact: paper plane — the baked Alembic fold (flat sheet -> plane) plays on hover over the headline, then the plane flies away ---------- */
(() => {
  const cv = document.getElementById("planeCv");
  const foot = document.getElementById("contact");
  const cta = foot && foot.querySelector(".contact__cta");
  const A = window.PLANE_ANIM;
  if (!cv || !foot || !cta || !A || !window.THREE || REDUCED) return;
  const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40); // orthographic = true isometry
  cam.position.set(0, 0, 6.2);
  // baked frames: int16, [frame][tri][vertex][xyz]
  const bin = atob(A.d), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const q = new Int16Array(u8.buffer), per = A.t * 9;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(per);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  let curFrame = -1;
  const setFrame = (f) => {
    f = Math.max(0, Math.min(A.f - 1, Math.round(f)));
    if (f === curFrame) return; curFrame = f;
    for (let i = 0; i < per; i++) pos[i] = q[f * per + i] / A.q;
    geo.attributes.position.needsUpdate = true;
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: `varying vec3 vP; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vP = mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vP; void main(){
  vec3 n = normalize(cross(dFdx(vP), dFdy(vP)));
  float d1 = abs(dot(n, normalize(vec3(-0.35, 0.7, 0.85))));
  gl_FragColor = vec4(vec3(0.824, 0.925, 0.612) * (0.5 + 0.62 * d1), 1.0); }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  const orient = new THREE.Group(); orient.rotation.x = -Math.PI / 2; orient.add(mesh); // lay the paper flat: its thickness axis becomes world-up
  const holder = new THREE.Group(); holder.add(orient); scene.add(holder);
  const home = { x: 0, y: 0 }, u = { v: 0.004 };
  const fx = { fly: 0, s: 1, frame: A.f - 1, W: 1, H: 1 };
  const size = () => {
    const f = foot.getBoundingClientRect(), c = cta.getBoundingClientRect();
    const W = Math.max(f.width, 10), H = Math.max(f.height, 10);
    renderer.setSize(W, H, false);
    const hh = 6.2 * Math.tan((15 * Math.PI) / 180); cam.top = hh; cam.bottom = -hh; cam.left = -hh * (W / H); cam.right = hh * (W / H); cam.updateProjectionMatrix();
    u.v = (2 * 6.2 * Math.tan((30 * Math.PI) / 360)) / H;
    const narrow = W < 700; fx.k = narrow ? 0.5 : 1;
    const px = narrow ? W - 96 : W - Math.min(300, W * 0.22) - 24 - Math.min(140, W * 0.1), py = narrow ? c.top - f.top - 56 : c.top - f.top + c.height * 0.5;
    home.x = (px - W / 2) * u.v; home.y = (H / 2 - py) * u.v;
    fx.W = W; fx.H = H;
  };
  size(); addEventListener("resize", size); addEventListener("load", size);
  fx.frame = A.f - 1;
  // real longitudinal axis of the folded plane: from the nose to the middle of the tail edge
  const axis = new THREE.Vector3(1, 0, 0), pivot = new THREE.Vector3();
  {
    const f = A.f - 1, pts = [];
    for (let i = 0; i < per; i += 3) { const x = q[f * per + i] / A.q, y = q[f * per + i + 1] / A.q, z = q[f * per + i + 2] / A.q; if (x || y || z) pts.push([x, y, z]); }
    let nose = pts[0]; pts.forEach((p) => { if (p[0] < nose[0]) nose = p; });
    const mx = Math.max(...pts.map((p) => p[0])), tail = pts.filter((p) => p[0] > mx - 0.08);
    const tm = tail.reduce((s, p) => [s[0] + p[0] / tail.length, s[1] + p[1] / tail.length, s[2] + p[2] / tail.length], [0, 0, 0]);
    axis.set(tm[0] - nose[0], tm[1] - nose[1], tm[2] - nose[2]).normalize();
    pivot.set(nose[0], nose[1], nose[2]).lerp(new THREE.Vector3(tm[0], tm[1], tm[2]), 0.5);
  }
  const rollQ = new THREE.Quaternion(), pv = new THREE.Vector3();
  // isometric view: yaw the plane to the wanted heading, then look at it from the classic 35.264° / 45° angle
  const YAW = window.PLANE_YAW !== undefined ? window.PLANE_YAW : Math.PI;
  const isoQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.atan(1 / Math.SQRT2), Math.PI / 4 + YAW, 0, "XYZ"));
  const mouse = { x: 0, y: 0 }, aim = { x: 0, y: 0 };
  fx.s = 1;
  const VIEW = window.PLANE_VIEW || { x: 0.2, y: -0.6, z: 0 };
  let vis = false;
  new IntersectionObserver((e) => (vis = e[0].isIntersecting), { threshold: 0 }).observe(foot);
  let t = 0;
  gsap.ticker.add((_t, dt) => {
    if (!vis) return;
    t += dt / 1000;
    aim.x += (mouse.x - aim.x) * 0.06; aim.y += (mouse.y - aim.y) * 0.06;
    const f = fx.fly, f2 = f * f;
    setFrame(fx.frame);
    holder.quaternion.copy(isoQ);
    rollQ.setFromAxisAngle(axis, Math.sin(t * 1.9) * 0.3); mesh.quaternion.copy(rollQ); mesh.position.copy(pv.copy(pivot).applyQuaternion(rollQ).multiplyScalar(-1).add(pivot)); // bobbing: rocks the wings around the real nose-to-tail axis
    holder.scale.setScalar(0.8 * (fx.k || 1) * Math.max(fx.s, 0.0001) * (1 - f * 0.35));
    holder.position.set(home.x + f2 * fx.W * u.v * 0.85, home.y + Math.sin(t * 1.9 + 1.2) * 0.05 + f2 * fx.H * u.v * 0.8, 0);
    holder.visible = fx.s > 0.002 && f < 1;
    renderer.render(scene, cam);
  });
})();


/* ---------- contact links: name rolls to italic serif on hover (same as awards) ---------- */
document.querySelectorAll(".contact-link > span").forEach((el) => {
  const label = el.textContent.trim();
  el.innerHTML = '<span class="sl" aria-hidden="true"><span class="sl__w"><span class="sl__a"></span><span class="sl__b"></span></span></span>';
  el.querySelector(".sl__a").textContent = label;
  el.querySelector(".sl__b").textContent = label;
  el.setAttribute("aria-label", label);
});

/* nav counter: number of awards */
(function () {
  const n = [...document.querySelectorAll(".award-row__count b[data-count]")].reduce((s, el) => s + (+el.dataset.count || 0), 0);
  document.querySelectorAll('[data-count="awards"]').forEach((el) => (el.textContent = "(" + n + ")"));
})();

/* ---------- pipeline cards: small 3D tilt toward the pointer ---------- */
if (!COARSE && !REDUCED) {
  document.querySelectorAll(".pipe-node").forEach((el) => {
    const rx = gsap.quickTo(el, "rotationX", { duration: 0.6, ease: "power3.out" });
    const ry = gsap.quickTo(el, "rotationY", { duration: 0.6, ease: "power3.out" });
    gsap.set(el, { transformPerspective: 600 });
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      ry(px * 22);
      rx(-py * 22);
    });
    el.addEventListener("pointerleave", () => { rx(0); ry(0); });
  });
}
