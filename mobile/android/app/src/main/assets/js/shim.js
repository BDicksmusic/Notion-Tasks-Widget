
if (window.Capacitor && window.Capacitor.isNativePlatform()) {
  window.WidgetAPI = {
    getSavedViews: () => {
      console.log('WidgetAPI.getSavedViews called on mobile, returning empty array.');
      return [];
    }
  };
}
