import * as THREE from 'three';

const DWELL = 2.1;   // seconds held at each waypoint

/**
 * The reader. It walks the building in dependency order, which is the order the
 * sentence is actually understood in, and names the role each volume plays as
 * it arrives. Reading the sentence and walking the building are the same act.
 */
export default class Reader {
  constructor(scene) {
    this.group = new THREE.Group();

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 24, 18),
      new THREE.MeshStandardMaterial({
        color: 0xf3e3c4, emissive: 0xd8a24a, emissiveIntensity: 3.2, roughness: 0.3,
      }),
    );
    core.position.y = 1.5;

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.72, 0.035, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xd8a24a, transparent: true, opacity: 0.55 }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 1.5;

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 1.5, 8),
      new THREE.MeshBasicMaterial({ color: 0xd8a24a, transparent: true, opacity: 0.35 }),
    );
    stem.position.y = 0.75;

    this.lamp = new THREE.PointLight(0xf0c47a, 26, 26, 2);
    this.lamp.position.y = 1.6;

    this.core = core;
    this.halo = halo;
    this.group.add(core, halo, stem, this.lamp);
    scene.add(this.group);

    this.waypoints = [];
    this.index = 0;
    this.dwell = 0;
    this.speed = 3.4;
    this.active = false;
    this.onArrive = null;
    this.tmp = new THREE.Vector3();
  }

  load(waypoints, speedScale = 1) {
    this.waypoints = waypoints;
    this.speed = 3.4 * speedScale;
    this.index = 0;
    this.dwell = 0;
    this.active = waypoints.length > 0;
    if (this.active) {
      this.group.position.copy(waypoints[0].position);
      this.announce(waypoints[0]);
      this.dwell = DWELL;
    }
    this.group.visible = this.active;
  }

  announce(wp) {
    if (this.onArrive) this.onArrive(wp, this.index, this.waypoints.length);
  }

  update(dt, elapsed) {
    if (!this.active || this.waypoints.length === 0) return;
    this.core.position.y = 1.5 + Math.sin(elapsed * 1.8) * 0.09;
    this.halo.position.y = this.core.position.y;
    this.halo.rotation.z = elapsed * 0.7;

    if (this.dwell > 0) {
      this.dwell -= dt;
      return;
    }

    const target = this.waypoints[(this.index + 1) % this.waypoints.length].position;
    this.tmp.subVectors(target, this.group.position);
    const dist = this.tmp.length();
    if (dist < 0.35) {
      this.index = (this.index + 1) % this.waypoints.length;
      this.dwell = DWELL;
      this.announce(this.waypoints[this.index]);
      return;
    }
    this.tmp.multiplyScalar(Math.min(this.speed * dt, dist) / dist);
    this.group.position.add(this.tmp);
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
