import { useCallback, useEffect, useRef, useState } from 'react';

const LONG_PRESS_MS = 500;
const ARM_TIMEOUT_MS = 4000;
const MOVE_TOLERANCE_PX = 10;

/**
 * On mobile, opening an item requires two taps (first arms it, second opens) or one long press.
 * On desktop (`enabled` false) a single click opens immediately.
 * Spread `getPressProps(id, open)` onto the card; use `armedId` for visual feedback.
 */
export default function useTwoTapOpen(enabled) {
  const [armedId, setArmedId] = useState(null);
  const armTimerRef = useRef(null);
  const pressTimerRef = useRef(null);
  const pressStartRef = useRef(null);
  const longPressedRef = useRef(false);

  const clearPress = () => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = null;
    pressStartRef.current = null;
  };

  const disarm = useCallback(() => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    armTimerRef.current = null;
    setArmedId(null);
  }, []);

  useEffect(() => () => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
  }, []);

  useEffect(() => {
    if (!enabled) disarm();
  }, [enabled, disarm]);

  const getPressProps = useCallback((id, open) => {
    const onClick = () => {
      if (!enabled) {
        open();
        return;
      }
      if (longPressedRef.current) {
        longPressedRef.current = false;
        return;
      }
      if (armedId === id) {
        disarm();
        open();
        return;
      }
      setArmedId(id);
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
      armTimerRef.current = setTimeout(() => setArmedId(null), ARM_TIMEOUT_MS);
    };
    if (!enabled) return { onClick };
    return {
      onClick,
      onTouchStart: (e) => {
        longPressedRef.current = false;
        const touch = e.touches?.[0];
        pressStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        pressTimerRef.current = setTimeout(() => {
          pressTimerRef.current = null;
          longPressedRef.current = true;
          disarm();
          open();
        }, LONG_PRESS_MS);
      },
      onTouchMove: (e) => {
        const start = pressStartRef.current;
        const touch = e.touches?.[0];
        if (!start || !touch) return;
        if (Math.abs(touch.clientX - start.x) > MOVE_TOLERANCE_PX
          || Math.abs(touch.clientY - start.y) > MOVE_TOLERANCE_PX) {
          clearPress();
        }
      },
      onTouchEnd: clearPress,
      onTouchCancel: clearPress,
      onContextMenu: (e) => e.preventDefault(),
    };
  }, [enabled, armedId, disarm]);

  return { armedId, getPressProps, disarm };
}
