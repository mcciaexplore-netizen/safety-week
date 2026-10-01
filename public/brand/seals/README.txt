ROUND SEALS, ONE PER BRANCH
===========================
Replace these five files with the real seals (keep the file names):

  SBR.png   SB Road
  TIL.png   Tilak Road
  BHO.png   Bhosari
  HAD.png   Hadapsar
  AHL.png   Ahilyanagar

Right now they are copies of the old generic MCCIA stamp so every invoice has something printed.
The seal is chosen automatically from the branch code inside the invoice number (NSW27-TIL-000007 -> TIL.png)
and is fixed: users cannot change or remove it. PNG with a transparent background, roughly square (about 300x300 px or more), works best.
After replacing a file, restart `npm run dev` or refresh the browser (images are cached by the browser).
