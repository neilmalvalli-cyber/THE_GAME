/**
 * Dealer character configuration.
 *
 * Drop a rigged character at  public/models/dealer.glb  and it replaces the
 * blockout rig automatically. Mixamo, Character Creator / iClone (CC_Base_*),
 * Rigify (DEF-*) and generic "LeftArm/RightForeArm" naming are recognised.
 *
 * Recommended asset: a seated character in a dark overcoat with gloves, with a
 * seated idle clip (e.g. Mixamo "Sitting Idle" / "Sitting" exported "with skin"
 * as glTF). If no seated clip is present, the procedural seated pose below is
 * applied to the legs/hips.
 */
export const DEALER_CONFIG = {
  url: 'models/dealer.glb',

  // Transform applied to the loaded model (after auto unit detection)
  scale: 1,
  offset: [0, 0, 0],          // meters, relative to the dealer's seat origin
  rotationY: 0,               // radians; the dealer must face +Z

  // Name (case-insensitive substring) of the base seated animation clip.
  seatedClip: 'sit',

  // Finger curl axis in each finger bone's LOCAL space and its sign per hand.
  // Mixamo: fingers run along local +Y, curl around local Z.
  // If fingers bend backwards on your rig, flip the sign.
  fingerCurl: {
    axis: [0, 0, 1],
    sign: { L: 1, R: -1 },
    maxAngles: [1.0, 1.35, 1.0], // per phalanx (radians at curl = 1)
    thumbAxis: [1, 0, 0],
    thumbSign: { L: -1, R: 1 },
  },

  // Procedural seated pose when the GLB has no seated clip (dealer space, radians)
  proceduralSeat: {
    upLeg: [-1.45, 0, 0],
    leg: [1.5, 0, 0],
    foot: [-0.15, 0, 0],
  },

  // Elbow pole hints (dealer space offsets from the shoulder)
  pole: { R: [-0.45, -0.35, -0.25], L: [0.45, -0.35, -0.25] },
};
