// A minimal full-screen fragment shader runner for the skin backgrounds.
// It renders below screen resolution (the scenes are soft, so a quarter of the
// pixels looks the same once the browser scales it up), caps the frame rate,
// and stops drawing while the tab is hidden or the canvas is off screen.

type Uniform = number | readonly number[];

export interface ShaderOptions {
  /** Fraction of CSS pixels to render (0.25 = a quarter in each direction). */
  scale: number;
  fps: number;
  /** Draw one frame and stop (reduced motion). */
  still?: boolean;
  /** Read every frame, so a palette change shows without restarting. */
  uniforms: () => Record<string, Uniform>;
  /** Transparent canvas (premultiplied output from the shader). */
  alpha?: boolean;
}

const VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

export function runShader(canvas: HTMLCanvasElement, frag: string, o: ShaderOptions): () => void {
  const gl = canvas.getContext("webgl", { alpha: !!o.alpha, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  if (!gl) return () => {};
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn("[skin] shader:", gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  // One triangle that covers the screen.
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const locs = new Map<string, WebGLUniformLocation | null>();
  const set = (name: string, v: Uniform) => {
    if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name));
    const l = locs.get(name);
    if (!l) return;
    if (typeof v === "number") gl.uniform1f(l, v);
    else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
    else if (v.length === 4) gl.uniform4f(l, v[0], v[1], v[2], v[3]);
  };

  let w = 0;
  let h = 0;
  const fit = () => {
    const nw = Math.max(1, Math.round(canvas.clientWidth * o.scale));
    const nh = Math.max(1, Math.round(canvas.clientHeight * o.scale));
    if (nw === w && nh === h) return false;
    w = canvas.width = nw;
    h = canvas.height = nh;
    gl.viewport(0, 0, w, h);
    return true;
  };

  const t0 = performance.now();
  const draw = (now: number) => {
    fit();
    set("uRes", [w, h]);
    set("uTime", (now - t0) / 1000);
    for (const [k, v] of Object.entries(o.uniforms())) set(k, v);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  let raf = 0;
  let last = 0;
  let visible = true;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden || now - last < 1000 / o.fps) return;
    last = now;
    draw(now);
  };

  const ro = new ResizeObserver(() => {
    if (fit() && o.still) draw(performance.now());
  });
  ro.observe(canvas);
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(canvas);

  if (o.still) draw(performance.now());
  else raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}

export const hexToVec3 = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Shared noise for the fragment shaders. */
export const GLSL_NOISE = `
float hash3(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise3(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm3(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise3(p);p=p*2.02+vec3(3.1,1.7,5.3);a*=.5;}return v;}
`;
