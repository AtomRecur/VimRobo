import { useEffect, useRef } from "react";
import { X, MapPin, Clock3 } from "lucide-react";
import type { Observation } from "../data/scenarios";
export default function ObservationDialog({
  observation,
  onClose,
}: {
  observation: Observation | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (observation && !ref.current?.open) ref.current?.showModal();
    else if (!observation && ref.current?.open) ref.current?.close();
  }, [observation]);
  return (
    <dialog
      ref={ref}
      className="observation-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="observation-title"
    >
      {observation && (
        <>
          <button
            className="dialog-close icon-button"
            onClick={onClose}
            aria-label="Close observation"
          >
            <X size={20} />
          </button>
          <img
            className="dialog-image"
            src={observation.image}
            alt={observation.title}
          />
          <div className="dialog-content">
            <div className="eyebrow">
              {observation.imageProvenance === "paper-frame"
                ? "EXTRACTED PAPER FRAME · FIG. 8"
                : "ILLUSTRATIVE FRAME"}
            </div>
            <h2 id="observation-title">{observation.title}</h2>
            <div className="observation-metadata">
              <span>
                <Clock3 size={15} />
                {observation.timestamp}
              </span>
              <span>
                <MapPin size={15} />
                {observation.sourcePosition
                  ? `Recorded XY: [${observation.sourcePosition.join(", ")}]`
                  : "Conceptual scene position"}
              </span>
            </div>
            <p>{observation.description}</p>
            {observation.video && (
              <video
                src={`${observation.video.src}#t=${observation.video.time}`}
                controls
                preload="metadata"
              />
            )}
            <small>
              {observation.imageProvenance === "paper-frame"
                ? "Original embedded frame, 320 × 320 px. The miniature world is an illustrative spatial presentation."
                : "This image illustrates the observation; it is not an original robot camera frame."}
            </small>
          </div>
        </>
      )}
    </dialog>
  );
}
