package protocol

import (
	"encoding/json"
	"testing"
)

func TestInfoJSON(t *testing.T) {
	zero, rssi := int64(0), -61
	cases := []struct {
		msg  any
		want string
	}{
		{Hello{T: TypeHello, V: 1, Token: "awk_x"}, `{"t":"hello","v":1,"token":"awk_x"}`},
		{Hello{T: TypeHello, V: 1, Token: "awk_x", Info: &Info{Host: "pc"}}, `{"t":"hello","v":1,"token":"awk_x","info":{"host":"pc"}}`},
		// Zero integers are real values (uptime 0), so pointers keep them.
		{InfoMessage{T: TypeInfo, Info: Info{Uptime: &zero, RSSI: &rssi}}, `{"t":"info","rssi":-61,"uptime":0}`},
		{InfoMessage{T: TypeInfo}, `{"t":"info"}`},
	}
	for _, c := range cases {
		b, err := json.Marshal(c.msg)
		if err != nil {
			t.Fatal(err)
		}
		if string(b) != c.want {
			t.Errorf("got %s, want %s", b, c.want)
		}
	}
	if !(Info{}).IsZero() || (Info{Uptime: &zero}).IsZero() {
		t.Error("IsZero")
	}
}
