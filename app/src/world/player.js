import * as THREE from 'three';

const EYE = 1.68;
const RADIUS = 0.45;
const WALK = 5.4;
const SPRINT = 11;

/**
 * One rig drives both modes. On desktop the rig carries yaw and the camera
 * carries pitch; in XR the headset writes the camera pose and the rig is what
 * the thumbstick moves, so locomotion code is not duplicated per mode.
 */
export default class Player {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;
    this.rig = new THREE.Group();
    this.rig.add(camera);
    camera.position.set(0, EYE, 0);

    this.yaw = 0;
    this.pitch = 0;
    this.velocityY = 0;
    this.flying = false;
    this.keys = new Set();
    this.colliders = [];
    this.sample = () => 0;
    this.locked = false;

    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.box = new THREE.Box3();

    this.onKeyDown = (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onMouseMove = (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.35, 1.35);
    };
    this.onLockChange = () => {
      this.locked = document.pointerLockElement === this.dom;
      document.body.classList.toggle('locked', this.locked);
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  requestLock() {
    this.dom.requestPointerLock?.();
  }

  setWorld({ colliders, sample }) {
    this.colliders = colliders;
    this.sample = sample;
  }

  teleport(x, z) {
    this.rig.position.set(x, this.sample(x, z), z);
    this.velocityY = 0;
  }

  blocked(x, z, y) {
    this.box.min.set(x - RADIUS, y + 0.3, z - RADIUS);
    this.box.max.set(x + RADIUS, y + EYE, z + RADIUS);
    return this.colliders.some((c) => c.intersectsBox(this.box));
  }

  update(dt, xrSession) {
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) ? SPRINT : WALK;
    let ix = 0;
    let iz = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;

    if (xrSession) {
      for (const source of xrSession.inputSources) {
        const axes = source.gamepad?.axes;
        if (!axes || axes.length < 4) continue;
        const [, , ax, az] = axes;
        if (source.handedness === 'right') {
          if (Math.abs(ax) > 0.15) this.yaw -= ax * dt * 2.0;
        } else {
          if (Math.abs(ax) > 0.15) ix += ax;
          if (Math.abs(az) > 0.15) iz += az;
        }
      }
      // The headset owns head height; the rig must not add eye height on top.
      this.camera.position.y = 0;
    } else {
      this.camera.position.y = EYE;
      this.camera.rotation.set(this.pitch, 0, 0);
    }
    this.rig.rotation.y = this.yaw;

    const len = Math.hypot(ix, iz);
    if (len > 0) {
      ix /= len;
      iz /= len;
      const s = speed * dt;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const dx = (ix * cos - iz * sin) * s;
      const dz = (ix * sin + iz * cos) * s;
      const { x, y, z } = this.rig.position;
      if (!this.blocked(x + dx, z, y)) this.rig.position.x = x + dx;
      if (!this.blocked(this.rig.position.x, z + dz, y)) this.rig.position.z = z + dz;
    }

    const ground = this.sample(this.rig.position.x, this.rig.position.z);
    this.flying = this.keys.has('Space');
    if (this.flying) {
      this.velocityY = 6.5;
    } else if (this.rig.position.y > ground + 0.02) {
      this.velocityY -= 19 * dt;
    } else {
      this.velocityY = 0;
      this.rig.position.y = ground;
    }
    this.rig.position.y = Math.max(ground, this.rig.position.y + this.velocityY * dt);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }
}
