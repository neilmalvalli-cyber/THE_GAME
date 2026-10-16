import * as THREE from 'three';
import { gsap } from 'gsap';
import { HOVER, TIMING, STATES as S } from '../config.js';

const CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="9" fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="3"/><circle cx="16" cy="16" r="9" fill="none" stroke="rgba(245,230,200,0.95)" stroke-width="1.4"/><circle cx="16" cy="16" r="1.6" fill="rgba(245,230,200,0.95)"/></svg>',
)}") 16 16, pointer`;

/**
 * Pointer → folder. Raycasts at most once per frame, only while the desk is
 * interactive. Hover is a tween on the folder's pose *towards rest + offset*
 * and back *to the stored rest* — never relative — so nothing can drift.
 */
export class FolderHoverController {
  constructor({ dom, camera, folders, state, audio, onSelect, getOpenFolder, onPhotoHover, onPhotoSelect, getSelectedPhoto }) {
    this.dom = dom;
    this.camera = camera;
    this.folders = folders;
    this.state = state;
    this.audio = audio;
    this.onSelect = onSelect;
    this.getOpenFolder = getOpenFolder || (() => null);
    this.onPhotoHover = onPhotoHover || (() => {});
    this.onPhotoSelect = onPhotoSelect || (() => {});
    this.getSelectedPhoto = getSelectedPhoto || (() => null);
    this.hoveredPhoto = null; // { folderId, index }
    this.hoveredId = null;
    this.reducedMotion = false;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2(9, 9);
    this.hasPointer = false;
    this.dirty = false;
    this.pickables = folders.flatMap((f) => f.pickables);

    this._move = (e) => { this._setNdc(e); this.hasPointer = true; this.dirty = true; };
    this._leave = () => { this.hasPointer = false; this.dirty = true; };
    this._down = (e) => {
      if (e.button !== 0) return;
      this._setNdc(e); this.hasPointer = true;
      if (this.state.is(S.FOLDER_OPEN)) {
        const ph = this._pickPhoto();
        if (ph) this.onPhotoSelect(ph.folderId, ph.index, e.pointerType);
        return;
      }
      const id = this._pick();
      if (id != null && this.interactive()) this.onSelect(id);
    };
    dom.addEventListener('pointermove', this._move);
    dom.addEventListener('pointerleave', this._leave);
    dom.addEventListener('pointerdown', this._down);
  }

  _setNdc(e) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  /** Write the cursor only when it changes (this runs every frame; style writes aren't free). */
  _cursor(v) {
    if (this._cursorVal === v) return;
    this._cursorVal = v;
    this.dom.style.cursor = v;
  }

  interactive() { return this.state.is(S.DESK_IDLE, S.FOLDER_HOVER); }

  _pick() {
    if (!this.hasPointer) return null;
    this.ray.setFromCamera(this.ndc, this.camera);
    // only files at rest can be hovered: the landing / opening owns the others' transforms
    const hits = this.ray.intersectObjects(this.pickables.filter((m) => m.parent?.visible !== false
      && ['IDLE', 'HOVERED'].includes(this._folder(m.userData.folderId)?.phase)), false);
    return hits.length ? hits[0].object.userData.folderId : null;
  }

  _pickPhoto() {
    const f = this.getOpenFolder();
    if (!f || !this.hasPointer) return null;
    this.ray.setFromCamera(this.ndc, this.camera);
    const hits = this.ray.intersectObjects(f.polaroids.meshes, false);
    return hits.length ? { folderId: f.id, index: hits[0].object.userData.photoIndex } : null;
  }

  _updatePhotos() {
    if (!this.dirty) return;
    this.dirty = false;
    const ph = this._pickPhoto();
    const same = ph && this.hoveredPhoto && ph.folderId === this.hoveredPhoto.folderId && ph.index === this.hoveredPhoto.index;
    this._cursor(ph ? CURSOR : '');
    if (same || (!ph && !this.hoveredPhoto)) return;
    this.clearPhotos();
    if (ph) {
      this.getOpenFolder().polaroids.hover(ph.index, true, this.reducedMotion);
      this.audio.photoShift(ph.folderId * 10 + ph.index);
      this.hoveredPhoto = ph;
      this.onPhotoHover(ph.folderId, ph.index);
    }
  }

  /** Lower any lifted photo (used on leave and before the folder closes). */
  clearPhotos() {
    if (this.hoveredPhoto) {
      const f = this.folders.find((x) => x.id === this.hoveredPhoto.folderId);
      // the selected photo stays lifted: it is the one the report describes
      if (this.getSelectedPhoto(this.hoveredPhoto.folderId) !== this.hoveredPhoto.index) {
        f?.polaroids.hover(this.hoveredPhoto.index, false, this.reducedMotion);
      }
      this.hoveredPhoto = null;
      this.onPhotoHover(null, null);
    }
  }

  /** Called every frame. */
  update() {
    if (this.state.is(S.FOLDER_OPEN)) { this._updatePhotos(); return; }
    if (this.hoveredPhoto) this.clearPhotos();
    if (!this.interactive()) { this._cursor(''); return; }
    if (!this.dirty) return;
    this.dirty = false;
    const id = this._pick();
    this._cursor(id != null ? CURSOR : '');
    if (id === this.hoveredId) return;
    if (this.hoveredId != null) this._out(this.hoveredId);
    this.hoveredId = id;
    if (id != null) {
      this._in(id);
      this.state.transition(S.FOLDER_HOVER, { folderId: id });
    } else {
      this.state.transition(S.DESK_IDLE);
    }
  }

  /** Force a re-evaluation (e.g. after returning to the desk). */
  refresh() { this.dirty = true; }

  _folder(id) { return this.folders.find((f) => f.id === id); }

  _in(id) {
    const f = this._folder(id), r = f.rest;
    if (f.phase !== 'IDLE' && f.phase !== 'HOVERED') return;
    f.phase = 'HOVERED';
    gsap.to(f.pose, {
      y: r.y + HOVER.lift, z: r.z + HOVER.forward, rx: r.rx + HOVER.tilt,
      x: r.x, ry: r.ry, rz: r.rz,
      duration: this.reducedMotion ? 0.12 : TIMING.hoverIn,
      ease: this.reducedMotion ? 'power1.out' : 'back.out(1.35)',
      overwrite: true,
    });
    this.audio.lift(id, 0, 0.8);
  }

  _out(id) {
    const f = this._folder(id), r = f.rest;
    if (f.phase === 'HOVERED') f.phase = 'IDLE';
    gsap.to(f.pose, {
      x: r.x, y: r.y, z: r.z, rx: r.rx, ry: r.ry, rz: r.rz,
      duration: this.reducedMotion ? 0.12 : TIMING.hoverOut,
      ease: 'power2.inOut',
      overwrite: true,
    });
  }

  /**
   * Hand a folder over to another sequence: stop hover tweens on it
   * (keeping its current lifted pose), send any other hovered folder home.
   */
  release(keepId) {
    for (const f of this.folders) {
      gsap.killTweensOf(f.pose);
      if (f.id !== keepId && !f.isAtRest()) this._out(f.id);
    }
    this.hoveredId = null;
    this._cursor('');
  }

  /** Hard clear: everything snaps to rest (used by reset / replay). */
  clear() {
    for (const f of this.folders) gsap.killTweensOf(f.pose);
    this.hoveredId = null;
    this.hoveredPhoto = null;
    this._cursor('');
    this.dirty = true;
  }

  dispose() {
    this.dom.removeEventListener('pointermove', this._move);
    this.dom.removeEventListener('pointerleave', this._leave);
    this.dom.removeEventListener('pointerdown', this._down);
    for (const f of this.folders) gsap.killTweensOf(f.pose);
  }
}
