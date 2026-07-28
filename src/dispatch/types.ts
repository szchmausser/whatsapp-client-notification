/** Extracted fields from a WhatsApp dispatch message */
export interface DispatchFields {
  vehicleType: string | null;
  plate: string | null;
  driverName: string | null;
  driverId: string | null;
  driverPhone: string | null;
  motorcycleCount: number | null;
  destinationName: string | null;
  matchedCompanyId: number | null;
  matchedConfidence: number | null;
  invoices: string | null;
  controlNotes: string | null;
  franelas: number | null;
  warranty: string | null;
}

/** Result of the dispatch classifier */
export interface ClassificationResult {
  isDispatch: boolean;
  confidence: number;       // 0.0 – 1.0
  dispatchType: string | null;
}

/** Result of company matching */
export interface MatcherResult {
  matchedCompanyId: number | null;
  matchedConfidence: number | null;
}

/** A company entry for destination matching */
export interface Company {
  id: number;
  name: string;
  keywords: string[];
  aliases: string[];
}
