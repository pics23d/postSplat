// [custom] Response shaping for a spring-return velocity device (03-integration-pattern.md).
//
// shape(v): remap the deadzone to zero, then apply sign(v)·|v|^gamma. gamma ≈ 1.6–2.0 feels
// right (pure cubic feels dead; linear is twitchy near center). Applied per axis, per frame.

export const DEFAULT_DEADZONE = 0.03;
export const DEFAULT_GAMMA = 1.75;

export const shape = (value: number, deadzone = DEFAULT_DEADZONE, gamma = DEFAULT_GAMMA) => {
    const magnitude = Math.abs(value);
    if (magnitude <= deadzone) {
        return 0;
    }
    const dz = Math.min(Math.max(deadzone, 0), 0.95);
    const remapped = Math.min((magnitude - dz) / (1 - dz), 1);
    return Math.sign(value) * Math.pow(remapped, gamma);
};

/** Clamp a frame delta so a stall (breakpoint, window drag) cannot hurl the camera. */
export const clampDeltaTime = (deltaTime: number, maxSeconds = 0.1) => {
    if (!(deltaTime > 0)) {
        return 0;
    }
    return Math.min(deltaTime, maxSeconds);
};
