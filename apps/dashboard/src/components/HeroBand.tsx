/* The workspace header band: title and summary on the left, the brand mark on the right. The same visual language as
   the sign-in pages and the website hero. With the motion layer on, a 3D scene behind the band (BrandScene) draws the
   mark in its box and a few light motes on the mark's side, behind the text and faded out under it, never over data;
   with it off (reduced motion, no WebGL, low power) the band is exactly the static band with the flat mark. */
import React from 'react';
import { BrandMark3D, BrandScene } from './BrandMark3D';

export function HeroBand({ eyebrow, title, sub, actions, children }: { eyebrow?: string; title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return <section className="heroBand">
    <BrandScene variant="band" />
    <div className="heroBandCopy">
      {eyebrow && <span className="bp-eyebrow bp-eyebrow-accent">{eyebrow}</span>}
      <h1>{title}</h1>
      {sub && <p className="sub">{sub}</p>}
      {actions && <div className="actions">{actions}</div>}
      {children}
    </div>
    <BrandMark3D className="heroBandMark" hosted />
  </section>;
}
