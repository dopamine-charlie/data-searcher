/**
 * Bootstrap - Use with SerperEnrichment.gs and/or TracerFYEnrichment.gs.
 * Adds menus only for scripts that are present.
 */
function onOpen() {
  if (typeof serperEnrichAll === 'function') {
    SpreadsheetApp.getUi()
      .createMenu('Serper')
      .addItem('Enrich All Rows', 'serperEnrichAll')
      .addItem('Enrich Selected Rows', 'serperEnrichSelected')
      .addItem('Enrich Empty Rows Only', 'serperEnrichEmpty')
      .addSeparator()
      .addItem('Settings → Set API Key', 'serperSetKey')
      .addItem('Settings → Validate Key', 'serperValidateKey')
      .addToUi();
  }
  if (typeof tracerfyEnrichSelected === 'function') {
    SpreadsheetApp.getUi()
      .createMenu('TracerFY')
      .addItem('Enrich Selected Rows', 'tracerfyEnrichSelected')
      .addSeparator()
      .addItem('Settings → Set API Key & Endpoint', 'tracerfySetKey')
      .addItem('Settings → Validate Key', 'tracerfyValidateKey')
      .addToUi();
  }
}
