package backend

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "os"
    "time"
)

var translatorURL = func() string {
    if u := os.Getenv("TRANSLATOR_URL"); u != "" {
        return u
    }
    return "http://localhost:5005"
}()

type TranslateRequest struct {
    Text       string `json:"text"`
    SourceLang string `json:"source_lang"`
}

type TranslateResponse struct {
    Translation string `json:"translation"`
}

func Translate(text, sourceLang string) (string, error) {
    reqBody := TranslateRequest{
        Text:       text,
        SourceLang: sourceLang,
    }
    b, _ := json.Marshal(&reqBody)
    client := &http.Client{Timeout: 15 * time.Second}
    resp, err := client.Post(fmt.Sprintf("%s/translate", translatorURL), "application/json", bytes.NewBuffer(b))
    if err != nil {
        return "", err
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        var msg map[string]interface{}
        _ = json.NewDecoder(resp.Body).Decode(&msg)
        return "", fmt.Errorf("translator error: status %d: %v", resp.StatusCode, msg)
    }

    var tr TranslateResponse
    if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
        return "", err
    }
    return tr.Translation, nil
}