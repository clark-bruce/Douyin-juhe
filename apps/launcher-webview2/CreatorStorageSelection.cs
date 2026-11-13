using System;
using System.Collections.Generic;

namespace DouyinJuheLauncherWebView2
{
    internal static class CreatorStorageSelection
    {
        private static readonly string[] Keys = {
            "security-sdk/s_sdk_sign_data_key/web_protect",
            "security-sdk/s_sdk_crypt_sdk",
            "security-sdk/s_sdk_cert_key",
        };

        private static List<Dictionary<string, object>> MergeFrom(
            Dictionary<string, object> localStorage,
            Dictionary<string, object> sessionStorage,
            IEnumerable<string> names)
        {
            var output = new List<Dictionary<string, object>>();
            foreach (var storage in new[] { sessionStorage, localStorage })
            {
                if (storage == null) continue;
                foreach (var name in names)
                {
                    object value;
                    if (!storage.TryGetValue(name, out value) || !(value is string) || String.IsNullOrWhiteSpace(Convert.ToString(value)) || Convert.ToString(value).Length > 60000) continue;
                    var duplicate = false;
                    foreach (var prior in output)
                        if (String.Equals(Convert.ToString(prior["name"]), name, StringComparison.Ordinal)) { duplicate = true; break; }
                    if (!duplicate) output.Add(new Dictionary<string, object> { { "name", name }, { "value", value } });
                }
            }
            return output;
        }

        public static List<Dictionary<string, object>> Merge(Dictionary<string, object> localStorage, Dictionary<string, object> sessionStorage)
        {
            // Creator refreshes some auth values in sessionStorage; it must win a same-key conflict.
            return MergeFrom(localStorage, sessionStorage, Keys);
        }

        public static List<Dictionary<string, object>> MergeAll(Dictionary<string, object> localStorage, Dictionary<string, object> sessionStorage)
        {
            // Match storageState's complete localStorage while retaining the
            // existing preference for fresh SDK values in sessionStorage.
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            if (localStorage != null)
                foreach (var item in localStorage)
                    if (item.Value is string) values[item.Key] = (string)item.Value;
            foreach (var item in Merge(localStorage, sessionStorage))
                values[(string)item["name"]] = (string)item["value"];
            var output = new List<Dictionary<string, object>>();
            foreach (var item in values)
                output.Add(new Dictionary<string, object> { { "name", item.Key }, { "value", item.Value } });
            return output;
        }

        public static bool HasSigningMaterial(List<Dictionary<string, object>> storage)
        {
            var crypt = false;
            var protect = false;
            foreach (var item in storage)
            {
                if (String.IsNullOrWhiteSpace(Convert.ToString(item["value"]))) continue;
                crypt |= String.Equals(Convert.ToString(item["name"]), Keys[1], StringComparison.Ordinal);
                protect |= String.Equals(Convert.ToString(item["name"]), Keys[0], StringComparison.Ordinal);
            }
            return crypt && protect;
        }
    }
}
