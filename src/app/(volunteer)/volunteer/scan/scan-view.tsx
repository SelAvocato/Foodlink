// Static layer (Figma p46, mobile): no data and no camera yet. The wiring step adds the
// token from the URL fragment and the camera.
export function ScanView() {
  return (
    <div className="mx-auto w-full max-w-md px-5 py-6">
      <h1 className="text-[28px] font-semibold leading-tight text-[#17261F]">Scan pickup QR</h1>
      <p className="mt-2 text-[15px] text-[#63746D]">Step 1 of 3 · Pickup verification</p>

      <div className="relative mt-9 h-[353px] w-full rounded-2xl bg-[#1D3029]">
        <p className="absolute left-[22px] top-[22px] pr-4 text-[15px] text-white">
          Point the camera at the donor’s QR label
        </p>
        <div className="absolute left-1/2 top-[90px] size-[220px] -translate-x-1/2 rounded-3xl border-2 border-[#D6E8DD]">
          <div className="absolute inset-x-[19px] top-1/2 h-0.5 bg-[#D6E8DD]" />
        </div>
        <p className="absolute bottom-[22px] left-[22px] text-[13px] text-white">Camera preview</p>
      </div>

      <div className="mt-6 rounded-xl bg-[#EAF4EE] px-5 py-5 text-[15px] leading-6 text-[#176448]">
        The QR must belong to your assigned task and the pickup window must not have expired.
      </div>

      <button
        type="button"
        disabled
        className="mt-9 inline-flex h-12 w-full items-center justify-center rounded-sm bg-[#176448] px-6 text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Enable camera
      </button>
      <p className="mt-5 text-[15px] text-[#63746D]">Camera access is required to scan.</p>
    </div>
  );
}
