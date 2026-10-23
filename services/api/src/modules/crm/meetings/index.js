// Meetings (CRM plan 4.5): invitations (invitations.js) and Google / Outlook calendar sync (calendar.js).
export { buildIcs, cancelMeetingInvitation, getMeetingInvitation, sendMeetingInvitation } from "./invitations.js";
export {
  calendarAuthorizeUrl, completeCalendarConnection, disconnectCalendar, hasCalendarConnections, listCalendarConnections, readCalendarState, syncCalendars, syncMeetingNow, syncMyCalendar,
} from "./calendar.js";
export { getMeetingVideo, getZoomSettings, makeZoomLinks, saveZoomSettings, setMeetingVideo } from "./video.js";
