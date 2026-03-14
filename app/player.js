import * as THREE from '../node_modules/three/build/three.module.js';

export function createPlayerController({
  camera,
  placementState,
  getGroundMesh,
  config,
}) {
  const {
    eyeHeight,
    moveSpeed,
    maxStepHeight,
    collisionRadius,
    collisionClearance,
    collisionBinarySteps,
    stepSearchPadding,
    supportNormalMinY,
    probeHeightOffsets,
    probeLateralOffsets,
    supportForwardOffsets,
  } = config;

  let playerSurfaceY = camera.position.y - eyeHeight;
  const playerForward = new THREE.Vector3();
  const playerRight = new THREE.Vector3();
  const playerStep = new THREE.Vector3();
  const playerAttemptDelta = new THREE.Vector3();
  const playerMoveDirection = new THREE.Vector3();
  const playerProbeSide = new THREE.Vector3();
  const playerProbeOrigin = new THREE.Vector3();
  const playerTargetPosition = new THREE.Vector3();
  const playerSupportOrigin = new THREE.Vector3();
  const playerSupportNormal = new THREE.Vector3();
  const playerDown = new THREE.Vector3(0, -1, 0);
  const playerSurfaceNormalMatrix = new THREE.Matrix3();
  const playerSweepBox = new THREE.Box3();
  const nearbyCollisionMeshes = [];
  const nearbySupportTargets = [];
  const playerRayHits = [];
  const playerSupportHits = [];
  const playerRaycaster = new THREE.Raycaster();
  const playerSupportRaycaster = new THREE.Raycaster();

  return {
    setSurfaceY(surfaceY) {
      playerSurfaceY = surfaceY;
      camera.position.y = playerSurfaceY + eyeHeight;
    },
    update(delta, pointer) {
      const strafeInput = Number(pointer.right) - Number(pointer.left);
      const forwardInput = Number(pointer.forward) - Number(pointer.back);
      const inputLength = Math.hypot(strafeInput, forwardInput);

      if (inputLength > 0) {
        const stepLength = ((pointer.sprint ? moveSpeed * 1.65 : moveSpeed) * delta) / inputLength;
        camera.getWorldDirection(playerForward);
        playerForward.y = 0;

        if (playerForward.lengthSq() < 0.0001) {
          playerForward.set(0, 0, -1);
        } else {
          playerForward.normalize();
        }

        playerRight.crossVectors(playerForward, camera.up);
        if (playerRight.lengthSq() < 0.0001) {
          playerRight.set(1, 0, 0);
        } else {
          playerRight.normalize();
        }

        if (Math.abs(forwardInput) >= Math.abs(strafeInput)) {
          movePlayerAlongAxis(playerForward, forwardInput * stepLength);
          movePlayerAlongAxis(playerRight, strafeInput * stepLength);
        } else {
          movePlayerAlongAxis(playerRight, strafeInput * stepLength);
          movePlayerAlongAxis(playerForward, forwardInput * stepLength);
        }
      }

      camera.position.y = playerSurfaceY + eyeHeight;
    },
  };

  function movePlayerAlongAxis(direction, distance) {
    if (Math.abs(distance) < 0.0001) {
      return;
    }

    playerStep.copy(direction).multiplyScalar(distance);
    attemptPlayerMove(playerStep);
  }

  function attemptPlayerMove(delta) {
    if (delta.lengthSq() < 0.000001) {
      return;
    }

    const resolvedSurfaceY = resolvePlayerMoveSurfaceY(delta);
    if (resolvedSurfaceY !== null) {
      camera.position.add(delta);
      playerSurfaceY = resolvedSurfaceY;
      return;
    }

    let min = 0;
    let max = 1;
    let bestSurfaceY = null;

    for (let iteration = 0; iteration < collisionBinarySteps; iteration += 1) {
      const midpoint = (min + max) * 0.5;
      playerAttemptDelta.copy(delta).multiplyScalar(midpoint);
      const candidateSurfaceY = resolvePlayerMoveSurfaceY(playerAttemptDelta);

      if (candidateSurfaceY === null) {
        max = midpoint;
      } else {
        min = midpoint;
        bestSurfaceY = candidateSurfaceY;
      }
    }

    if (bestSurfaceY !== null && min > 0.0001) {
      camera.position.addScaledVector(delta, min);
      playerSurfaceY = bestSurfaceY;
    }
  }

  function resolvePlayerMoveSurfaceY(delta) {
    const collisionMeshes = getNearbyCollisionMeshes(delta, maxStepHeight);
    const candidateSurfaceY = resolvePlayerSurfaceHeight(delta, collisionMeshes);

    if (candidateSurfaceY === null) {
      return null;
    }

    if (isPlayerMovementBlocked(delta, candidateSurfaceY + eyeHeight, collisionMeshes)) {
      return null;
    }

    return candidateSurfaceY;
  }

  function resolvePlayerSurfaceHeight(delta, collisionMeshes) {
    const supportTargets = getNearbySupportTargets(collisionMeshes);
    if (supportTargets.length === 0) {
      return playerSurfaceY;
    }

    const searchStartY = playerSurfaceY + maxStepHeight + stepSearchPadding;
    const searchDepth = maxStepHeight * 2 + stepSearchPadding * 2;
    let bestSurfaceY = null;

    playerMoveDirection.copy(delta).normalize();
    playerTargetPosition.set(camera.position.x + delta.x, 0, camera.position.z + delta.z);

    playerSupportRaycaster.near = 0;
    playerSupportRaycaster.far = searchDepth;

    for (const forwardOffset of supportForwardOffsets) {
      playerSupportOrigin.set(
        playerTargetPosition.x + playerMoveDirection.x * forwardOffset,
        searchStartY,
        playerTargetPosition.z + playerMoveDirection.z * forwardOffset,
      );

      playerSupportHits.length = 0;
      playerSupportRaycaster.set(playerSupportOrigin, playerDown);
      playerSupportRaycaster.intersectObjects(supportTargets, false, playerSupportHits);

      for (const hit of playerSupportHits) {
        const surfaceY = hit.point.y;
        const surfaceDelta = surfaceY - playerSurfaceY;

        if (surfaceDelta > maxStepHeight + collisionClearance) {
          continue;
        }

        if (surfaceDelta < -maxStepHeight - collisionClearance) {
          continue;
        }

        if (!isWalkableSupportHit(hit)) {
          continue;
        }

        if (bestSurfaceY === null || surfaceY > bestSurfaceY) {
          bestSurfaceY = surfaceY;
        }

        break;
      }
    }

    return bestSurfaceY;
  }

  function getNearbySupportTargets(collisionMeshes) {
    nearbySupportTargets.length = 0;

    const groundMesh = getGroundMesh();
    if (groundMesh) {
      nearbySupportTargets.push(groundMesh);
    }

    nearbySupportTargets.push(...collisionMeshes);
    return nearbySupportTargets;
  }

  function isWalkableSupportHit(hit) {
    const groundMesh = getGroundMesh();
    if (!hit.face) {
      return hit.object === groundMesh;
    }

    playerSupportNormal.copy(hit.face.normal);
    playerSurfaceNormalMatrix.getNormalMatrix(hit.object.matrixWorld);
    playerSupportNormal.applyNormalMatrix(playerSurfaceNormalMatrix).normalize();
    return playerSupportNormal.y >= supportNormalMinY;
  }

  function isPlayerMovementBlocked(
    delta,
    eyeY = playerSurfaceY + eyeHeight,
    collisionMeshes = getNearbyCollisionMeshes(delta),
  ) {
    if (collisionMeshes.length === 0) {
      return false;
    }

    const travelDistance = delta.length() + collisionRadius + collisionClearance;
    playerMoveDirection.copy(delta).normalize();
    playerProbeSide.set(-playerMoveDirection.z, 0, playerMoveDirection.x);

    playerRaycaster.near = 0;
    playerRaycaster.far = travelDistance;

    for (const heightOffset of probeHeightOffsets) {
      const probeY = eyeY + heightOffset;

      for (const lateralOffset of probeLateralOffsets) {
        playerProbeOrigin.set(camera.position.x, probeY, camera.position.z);
        if (lateralOffset !== 0) {
          playerProbeOrigin.addScaledVector(playerProbeSide, lateralOffset);
        }

        playerRayHits.length = 0;
        playerRaycaster.set(playerProbeOrigin, playerMoveDirection);
        playerRaycaster.intersectObjects(collisionMeshes, false, playerRayHits);

        if (playerRayHits.length > 0) {
          return true;
        }
      }
    }

    return false;
  }

  function getNearbyCollisionMeshes(delta, verticalPadding = 0) {
    nearbyCollisionMeshes.length = 0;

    const currentEyeY = playerSurfaceY + eyeHeight;
    const minY = currentEyeY + probeHeightOffsets[0] - collisionRadius - verticalPadding;
    const maxY = currentEyeY + probeHeightOffsets[probeHeightOffsets.length - 1] + collisionRadius + verticalPadding;
    const endX = camera.position.x + delta.x;
    const endZ = camera.position.z + delta.z;
    const padding = collisionRadius + collisionClearance + supportForwardOffsets[supportForwardOffsets.length - 1];

    playerSweepBox.min.set(
      Math.min(camera.position.x, endX) - padding,
      minY,
      Math.min(camera.position.z, endZ) - padding,
    );
    playerSweepBox.max.set(
      Math.max(camera.position.x, endX) + padding,
      maxY,
      Math.max(camera.position.z, endZ) + padding,
    );

    for (const item of placementState.placedItems) {
      if (item.collisionBounds.intersectsBox(playerSweepBox)) {
        nearbyCollisionMeshes.push(...item.collisionMeshes);
      }
    }

    return nearbyCollisionMeshes;
  }
}
