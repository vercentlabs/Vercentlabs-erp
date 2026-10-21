import FormPage, { metadata as formMetadata } from "./form-page";

export const metadata = formMetadata;

// Opened from inside the app, this form opens in a modal over the page it was opened from (see @modal/(.)sales/orders/new); opened as an
// address of its own (a bookmark, a link, a reload) it is a full page (Line-by-line audit).
export default FormPage;
