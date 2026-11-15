/* The additive 3D and motion layer (docs/PREMIUM_DIRECTION.md): nothing here changes a colour, token, font, logo,
   layout, size, radius, shadow or spacing at rest. Off under reduced motion, without WebGL and on low-power devices
   (./env). The 3D scenes are components/BrandMark3D.tsx (BrandScene) on top of ./scene, which loads with three.js as
   separate chunks; the workspace layer (./workspace) is its own small chunk too. Its stylesheet is imported here, once. */
import '../styles/motion.css';

export { RouteTransition, RouteOutlet } from './RouteTransition';
export { WorkspaceMotion } from './WorkspaceMotion';
export { motionAllowed, useMotionAllowed, onMotionPreferenceChange, webglAvailable, finePointer } from './env';
