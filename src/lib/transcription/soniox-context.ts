/** Soniox context — mirrors IT_Curves_Bot `build_soniox_context()`. */
export function buildSonioxContext(keyterms: string[] = []) {
  const terms = keyterms.slice(0, 200).filter(Boolean);
  const context: {
    general: Array<{ key: string; value: string }>;
    terms?: string[];
  } = {
    general: [
      { key: "domain", value: "Taxi and paratransit reservations" },
      {
        key: "topic",
        value:
          "Phone reservation for a taxi ride: booking, trip status, will-call, cancellation",
      },
      {
        key: "organization",
        value: "Barwood Cab and Regency Taxi, operated by IT Curves",
      },
      { key: "agent", value: "Alina" },
      {
        key: "service_area",
        value: "Maryland, Virginia, and Washington DC",
      },
    ],
  };

  if (terms.length) {
    context.terms = terms;
  }

  return context;
}
