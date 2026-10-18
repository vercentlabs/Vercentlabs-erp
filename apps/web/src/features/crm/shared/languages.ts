// The languages a lead or contact may speak (CRM plan 5.5): English and India's most spoken, by ISO 639-1 code.
export const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "en", label: "English" }, { value: "hi", label: "Hindi (हिन्दी)" }, { value: "mr", label: "Marathi (मराठी)" }, { value: "gu", label: "Gujarati (ગુજરાતી)" },
  { value: "bn", label: "Bengali (বাংলা)" }, { value: "ta", label: "Tamil (தமிழ்)" }, { value: "te", label: "Telugu (తెలుగు)" }, { value: "kn", label: "Kannada (ಕನ್ನಡ)" },
  { value: "ml", label: "Malayalam (മലയാളം)" }, { value: "pa", label: "Punjabi (ਪੰਜਾਬੀ)" }, { value: "or", label: "Odia (ଓଡ଼ିଆ)" }, { value: "as", label: "Assamese (অসমীয়া)" },
  { value: "ur", label: "Urdu (اردو)" },
];

export const languageLabel = (code: string | null | undefined) => (code ? LANGUAGES.find((entry) => entry.value === code)?.label ?? code.toUpperCase() : null);
