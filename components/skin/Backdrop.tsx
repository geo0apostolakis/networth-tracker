"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/components/term/hooks";
import { Dither } from "@/components/term/viz";
import { ATMOS_PALETTES, nextPalette, useSkin } from "@/lib/skin";
import { Crystal, Orbits, Planet, Rock, Shard } from "./orbitArt";
import { GLSL_NOISE, hexToVec3, runShader } from "./shader";

/** The scene behind the whole app for the chosen look. Fixed, under the
 *  content, never takes a click. Terminal and Capital have none. */
export function SkinBackdrop() {
  const skin = useSkin((s) => s.skin);
  if (skin === "orbit") return <OrbitBackdrop />;
  if (skin === "atmos") return <AtmosBackdrop />;
  if (skin === "hud") return <HudBackdrop />;
  return null;
}

/* ------------------------------------------------------------------ orbit */

// x/y in % of the viewport; the floats differ in length so nothing moves in step.
const FLOATERS: { x: number; y: number; k: "rock" | "rock2" | "shard" | "crystal"; s: number; r: number; d: number; phone?: boolean }[] = [
  { x: 56, y: -4, k: "rock", s: 130, r: -8, d: 14, phone: true },
  { x: 93, y: 16, k: "rock", s: 70, r: 20, d: 11 },
  { x: -3, y: 34, k: "rock2", s: 96, r: 12, d: 13, phone: true },
  { x: 95, y: 58, k: "rock", s: 84, r: -18, d: 12 },
  { x: 90, y: 80, k: "rock2", s: 64, r: 6, d: 15 },
  { x: 18, y: 7, k: "shard", s: 30, r: 25, d: 9, phone: true },
  { x: 44, y: 9, k: "shard", s: 22, r: -30, d: 10 },
  { x: 97, y: 42, k: "shard", s: 22, r: 60, d: 12 },
  { x: 1, y: 62, k: "shard", s: 20, r: 75, d: 8 },
  { x: 74, y: 5, k: "crystal", s: 26, r: 30, d: 10, phone: true },
  { x: -2, y: 76, k: "crystal", s: 110, r: -10, d: 16, phone: true },
];

function OrbitBackdrop() {
  return (
    <div className="skin-bg orbit-bg" aria-hidden>
      <Orbits className="orbit-rings" />
      {FLOATERS.map((f, i) => (
        <div
          key={i}
          className={`orbit-f${f.phone ? "" : " desk"}`}
          style={{ left: `${f.x}%`, top: `${f.y}%`, "--r": `${f.r}deg`, "--d": `${f.d}s`, animationDelay: `${-i * 1.7}s` } as React.CSSProperties}
        >
          {f.k === "rock" && <Rock size={f.s} />}
          {f.k === "rock2" && <Rock size={f.s} tone={1} />}
          {f.k === "shard" && <Shard size={f.s} />}
          {f.k === "crystal" && <Crystal size={f.s} />}
        </div>
      ))}
      <Planet className="orbit-planet" />
      <Grain />
    </div>
  );
}

/** A small tile of film grain, drawn once and repeated by CSS. */
function Grain() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 160;
    const ctx = c.getContext("2d");
    if (!ctx || !ref.current) return;
    const img = ctx.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ref.current.style.backgroundImage = `url(${c.toDataURL("image/png")})`;
  }, []);
  return <div ref={ref} className="skin-grain" />;
}

/* ------------------------------------------------------------------ atmos */

const FOG = `precision mediump float;
uniform vec2 uRes;uniform float uTime;uniform vec3 uC0;uniform vec3 uC1;uniform vec3 uC2;uniform vec3 uC3;uniform vec3 uEye;
${GLSL_NOISE}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  vec2 e=uv*vec2(.62,1.);
  float r=length(e);
  float a=atan(e.y,e.x);
  float t=uTime;
  float sw=a+1.3/(r+.3)-t*.03;
  vec2 d=vec2(cos(sw),sin(sw));
  float n1=fbm3(vec3(d*1.5,r*2.4+t*.015));
  float st=fbm3(vec3(d*2.1,r*9.-t*.05));
  float n2=fbm3(vec3(d*2.8,r*3.6+5.+t*.02));
  vec3 col=mix(uC0,uC1,smoothstep(.32,.72,n1));
  col=mix(col,uC2,smoothstep(.44,.8,st)*.85);
  col=mix(col,uC3,smoothstep(.55,.85,n2)*.5);
  float eye=smoothstep(.5,.15,r+(n1-.5)*.2);
  col=mix(col,uEye,eye);
  gl_FragColor=vec4(col,1.);
}`;

function AtmosBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();
  const palette = useSkin((s) => s.palette);
  const tone = useSkin((s) => s.tone);
  // Read by the shader every frame, so a palette or tone change needs no restart.
  const live = useRef({ palette, tone });
  useEffect(() => {
    live.current = { palette, tone };
  }, [palette, tone]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    return runShader(cv, FOG, {
      scale: 0.25,
      fps: 30,
      still: reduce,
      uniforms: () => {
        const { palette: p, tone: t } = live.current;
        const c = ATMOS_PALETTES[p].c.map(hexToVec3);
        const dark = t === "dark";
        const dim = (v: number[], k: number) => v.map((x) => x * k);
        return dark
          ? { uC0: dim(c[1], 0.55), uC1: dim(c[0], 0.42), uC2: dim(c[3], 0.5), uC3: dim(c[1], 0.8), uEye: hexToVec3("#1c1b1a") }
          : { uC0: c[0], uC1: c[1], uC2: c[2], uC3: c[3], uEye: hexToVec3("#f2f2f0") };
      },
    });
  }, [reduce]);
  return (
    <div className="skin-bg atmos-bg" aria-hidden>
      <canvas ref={ref} />
    </div>
  );
}

/** "Based on Frozen Slate": which palette colours the fog. Tap for the next. */
export function PaletteChip() {
  const skin = useSkin((s) => s.skin);
  const palette = useSkin((s) => s.palette);
  if (skin !== "atmos") return null;
  const p = ATMOS_PALETTES[palette];
  return (
    <button className="pal-chip" onClick={nextPalette} title="Change the fog colours">
      <i style={{ background: p.thumb }} />
      <span>
        {"Based on"}
        <b>{p.name}</b>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ hud */

function HudBackdrop() {
  return (
    <div className="skin-bg hud-bg" aria-hidden>
      <div className="hud-grid" />
      <i className="hud-streak" style={{ "--x": "18%", "--d": "9s", "--w": "0s" } as React.CSSProperties} />
      <i className="hud-streak" style={{ "--x": "62%", "--d": "13s", "--w": "-5s" } as React.CSSProperties} />
      <i className="hud-streak" style={{ "--x": "84%", "--d": "11s", "--w": "-8s" } as React.CSSProperties} />
      <span className="hud-corner tl" />
      <span className="hud-corner tr" />
      <span className="hud-corner bl" />
      <span className="hud-corner br" />
      <span className="hud-side l">{"NETWORTH // SYSTEM.ONLINE"}</span>
      <span className="hud-side r">{"EST.2026 [PORTFOLIO / V2]"}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ hero */

/** What sits behind the dashboard hero: the dither field in Terminal, chrome
 *  tubes in Capital, the HUD status tag, nothing where the page scene shows. */
export function HeroArt() {
  const skin = useSkin((s) => s.skin);
  if (skin === "terminal") return <Dither seed={7} intensity={0.6} />;
  if (skin === "capital") return <ChromeTubes />;
  if (skin === "hud")
    return (
      <div className="hud-hero-tag" aria-hidden>
        <i />
        {"NOW.ONLINE"}
      </div>
    );
  return null;
}

// Liquid-chrome ribbons, after the hero on cyphercapital.com: each tube is a
// curve with a round cross-section, shaded by reflecting a soft studio
// environment, with a thin-film rainbow toward the edges.
const CHROME = `precision highp float;
uniform vec2 uRes;uniform float uTime;
float tubeY(float x,float i,float t){
  float o=i<.5?0.:i<1.5?.17:i<2.5?-.15:.3;
  return -.3+o+(.95-.08*i)*x+.09*sin(2.2*x+i*2.4+t*.2)+.04*sin(4.4*x-i*2.7-t*.15);
}
vec3 env(vec3 R){
  float y=R.y;
  vec3 c=mix(vec3(.5,.51,.56),vec3(.97,.97,.99),smoothstep(-.6,.5,y));
  c-=vec3(.42)*smoothstep(.14,0.,abs(y+.12));
  c+=vec3(.25)*smoothstep(.6,.9,y);
  c=mix(c,c*vec3(.88,.86,.98),smoothstep(.3,-.8,R.x));
  return c;
}
vec3 irid(float k){return .5+.5*cos(6.2832*(vec3(0.,.33,.67)+k));}
void main(){
  float X=gl_FragCoord.x/uRes.x,Y=gl_FragCoord.y/uRes.y,asp=uRes.x/uRes.y;
  float px=1.6/uRes.y;
  vec4 acc=vec4(0.);
  for(int k=0;k<4;k++){
    float i=float(k);
    float y=tubeY(X,i,uTime);
    float m=(tubeY(X+.002,i,uTime)-y)/.002/asp;
    float d=(Y-y)/sqrt(1.+m*m);
    float w=.045+.014*i+.01*sin(X*3.+i*2.);
    float s=d/w;
    if(abs(s)<1.){
      vec2 pp=normalize(vec2(-m,1.));
      vec3 n=normalize(vec3(pp*s,sqrt(1.-s*s)));
      vec3 R=reflect(vec3(0.,0.,-1.),n);
      vec3 c=env(R);
      float fr=pow(1.-n.z,1.6);
      c=mix(c,c*irid(n.z*1.3+i*.21+X*.7),.6*fr);
      c*=.78+.22*n.z;
      float aa=smoothstep(1.,1.-px/w*1.5,abs(s));
      acc=vec4(mix(acc.rgb,c,aa),max(acc.a,aa));
    }
  }
  gl_FragColor=vec4(acc.rgb*acc.a,acc.a);
}`;

function ChromeTubes() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    return runShader(cv, CHROME, { scale: Math.min(2, devicePixelRatio || 1) * 0.6, fps: 30, still: reduce, alpha: true, uniforms: () => ({}) });
  }, [reduce]);
  return <canvas ref={ref} className="chrome-tubes" aria-hidden />;
}

/** Capital's sign-off: the name split to the two edges with the mark between,
 *  the way cyphercapital.com ends every page. */
export function SkinFooter() {
  const skin = useSkin((s) => s.skin);
  if (skin !== "capital") return null;
  return (
    <footer className="cap-foot no-print" aria-hidden>
      <span>{"My Little"}</span>
      <CapMark />
      <span>{"Networth"}</span>
    </footer>
  );
}

export function CapMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 24" width="40" height="24" aria-hidden>
      <path d="M11 4C6 4 3 7.6 3 12s3 8 8 8c6.5 0 11.5-16 18-16 5 0 8 3.6 8 8s-3 8-8 8C22.5 20 17.5 4 11 4Z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
    </svg>
  );
}
