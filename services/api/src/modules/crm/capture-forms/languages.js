// A web form in the visitor's language (CRM plan 5.6): the field labels and the button in Hindi and India's other most spoken
// languages. The form's own words — its name, consent notice and thank-you message — are written by the organization in that language.
// A lead from a form in a language other than English records that language.
export const FORM_LANGUAGES = Object.freeze(["en", "hi", "mr", "gu", "bn", "ta", "te", "kn", "ml", "pa"]);

const LABELS = Object.freeze({
  hi: { firstName: "पहला नाम", lastName: "उपनाम", email: "ईमेल", mobile: "मोबाइल", phone: "फ़ोन", companyName: "कंपनी", jobTitle: "पद", website: "वेबसाइट",
    city: "शहर", state: "राज्य", countryCode: "देश", industry: "उद्योग", productInterest: "आप किसमें रुचि रखते हैं?", description: "संदेश", submit: "भेजें" },
  mr: { firstName: "पहिले नाव", lastName: "आडनाव", email: "ईमेल", mobile: "मोबाइल", phone: "फोन", companyName: "कंपनी", jobTitle: "पद", website: "वेबसाइट",
    city: "शहर", state: "राज्य", countryCode: "देश", industry: "उद्योग", productInterest: "तुम्हाला कशात रस आहे?", description: "संदेश", submit: "पाठवा" },
  gu: { firstName: "પ્રથમ નામ", lastName: "અટક", email: "ઇમેઇલ", mobile: "મોબાઇલ", phone: "ફોન", companyName: "કંપની", jobTitle: "હોદ્દો", website: "વેબસાઇટ",
    city: "શહેર", state: "રાજ્ય", countryCode: "દેશ", industry: "ઉદ્યોગ", productInterest: "તમને શેમાં રસ છે?", description: "સંદેશ", submit: "મોકલો" },
  bn: { firstName: "প্রথম নাম", lastName: "পদবি", email: "ইমেল", mobile: "মোবাইল", phone: "ফোন", companyName: "কোম্পানি", jobTitle: "পদ", website: "ওয়েবসাইট",
    city: "শহর", state: "রাজ্য", countryCode: "দেশ", industry: "শিল্প", productInterest: "আপনি কীসে আগ্রহী?", description: "বার্তা", submit: "পাঠান" },
  ta: { firstName: "முதல் பெயர்", lastName: "குடும்பப் பெயர்", email: "மின்னஞ்சல்", mobile: "கைபேசி", phone: "தொலைபேசி", companyName: "நிறுவனம்", jobTitle: "பதவி",
    website: "இணையதளம்", city: "நகரம்", state: "மாநிலம்", countryCode: "நாடு", industry: "தொழில்", productInterest: "நீங்கள் எதில் ஆர்வமாக உள்ளீர்கள்?", description: "செய்தி", submit: "அனுப்பு" },
  te: { firstName: "మొదటి పేరు", lastName: "ఇంటి పేరు", email: "ఇమెయిల్", mobile: "మొబైల్", phone: "ఫోన్", companyName: "కంపెనీ", jobTitle: "హోదా", website: "వెబ్‌సైట్",
    city: "నగరం", state: "రాష్ట్రం", countryCode: "దేశం", industry: "పరిశ్రమ", productInterest: "మీకు దేనిపై ఆసక్తి ఉంది?", description: "సందేశం", submit: "పంపండి" },
  kn: { firstName: "ಮೊದಲ ಹೆಸರು", lastName: "ಅಡ್ಡ ಹೆಸರು", email: "ಇಮೇಲ್", mobile: "ಮೊಬೈಲ್", phone: "ಫೋನ್", companyName: "ಕಂಪನಿ", jobTitle: "ಹುದ್ದೆ", website: "ವೆಬ್‌ಸೈಟ್",
    city: "ನಗರ", state: "ರಾಜ್ಯ", countryCode: "ದೇಶ", industry: "ಉದ್ಯಮ", productInterest: "ನಿಮಗೆ ಯಾವುದರಲ್ಲಿ ಆಸಕ್ತಿ ಇದೆ?", description: "ಸಂದೇಶ", submit: "ಕಳುಹಿಸಿ" },
  ml: { firstName: "ആദ്യ പേര്", lastName: "കുടുംബപ്പേര്", email: "ഇമെയിൽ", mobile: "മൊബൈൽ", phone: "ഫോൺ", companyName: "കമ്പനി", jobTitle: "പദവി", website: "വെബ്സൈറ്റ്",
    city: "നഗരം", state: "സംസ്ഥാനം", countryCode: "രാജ്യം", industry: "വ്യവസായം", productInterest: "നിങ്ങൾക്ക് എന്തിലാണ് താൽപ്പര്യം?", description: "സന്ദേശം", submit: "അയയ്ക്കുക" },
  pa: { firstName: "ਪਹਿਲਾ ਨਾਮ", lastName: "ਗੋਤ", email: "ਈਮੇਲ", mobile: "ਮੋਬਾਈਲ", phone: "ਫ਼ੋਨ", companyName: "ਕੰਪਨੀ", jobTitle: "ਅਹੁਦਾ", website: "ਵੈੱਬਸਾਈਟ",
    city: "ਸ਼ਹਿਰ", state: "ਰਾਜ", countryCode: "ਦੇਸ਼", industry: "ਉਦਯੋਗ", productInterest: "ਤੁਹਾਡੀ ਕਿਸ ਵਿੱਚ ਦਿਲਚਸਪੀ ਹੈ?", description: "ਸੁਨੇਹਾ", submit: "ਭੇਜੋ" },
});

// The label of a field (or "submit") in a language; English when there is none.
export function formLabel(language, name, english) {
  return LABELS[language]?.[name] ?? english;
}
