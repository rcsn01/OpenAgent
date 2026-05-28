/*
TUI preview (the renderer stitches each left/right row with one gap column):
    "                   ",
    "█▀▀█ █▀▀█ █▀▀█ █▀▀▄",
    "█__█ █__█ █^^^ █__█",
    "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀",
*/
export const logo = {
  left: [
    "                   ",
    "█▀▀█ █▀▀█ █▀▀█ █▀▀▄",
    "█__█ █__█ █^^^ █__█",
    "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀",
  ],
  right: [
    "                   ",
    "█▀▀█ █▀▀█ █▀▀█ █▀▀▄",
    "█__█ █__█ █^^^ █__█",
    "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀",
  ],
}

export const go = {
  left: [
    "    ",
    "█▀▀▀",
    "█_^█",
    "▀▀▀▀",
  ],
  right: [
    "    ",
    "█▀▀█",
    "█__█",
    "▀▀▀▀",
  ],
}

export const marks = "_^~,"
