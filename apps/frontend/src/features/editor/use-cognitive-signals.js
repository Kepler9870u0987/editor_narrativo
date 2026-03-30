import { useEffect, useState } from 'react';
export function useCognitiveSignals(enabled, target) {
    const [state, setState] = useState({
        hesitationScore: 0,
        suggested: false,
    });
    useEffect(() => {
        if (!enabled || !target) {
            setState({ hesitationScore: 0, suggested: false });
            return;
        }
        let lastKeyDownAt = 0;
        let lastKeyUpAt = 0;
        let totalBackspaces = 0;
        const recompute = (delta) => {
            const hesitationScore = Math.min(100, Math.round(delta + totalBackspaces * 6));
            setState({
                hesitationScore,
                suggested: hesitationScore >= 45,
            });
        };
        const handleKeyDown = (event) => {
            const now = performance.now();
            const flightTime = lastKeyUpAt ? now - lastKeyUpAt : 0;
            lastKeyDownAt = now;
            if (event.key === 'Backspace') {
                totalBackspaces += 1;
            }
            recompute(flightTime);
        };
        const handleKeyUp = () => {
            const now = performance.now();
            const dwellTime = lastKeyDownAt ? now - lastKeyDownAt : 0;
            lastKeyUpAt = now;
            recompute(dwellTime);
        };
        target.addEventListener('keydown', handleKeyDown);
        target.addEventListener('keyup', handleKeyUp);
        return () => {
            target.removeEventListener('keydown', handleKeyDown);
            target.removeEventListener('keyup', handleKeyUp);
        };
    }, [enabled, target]);
    return state;
}
//# sourceMappingURL=use-cognitive-signals.js.map